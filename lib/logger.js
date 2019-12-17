const winston = require('winston');
const morgan = require('morgan');
const httpContext = require('express-http-context');
const shortid = require('shortid');
const _ = require('lodash');
const level = process.env.LOG_LEVEL || 'notice';
const { parse } = require('querystring');

const defaultOptions = {
  getLogLevelFromQuerystring: false,
  colorize: true,
  assetsPathRegex: null,
  clientMsgTrackerPath: '/__client-msg-tracking'
}

module.exports.initialize = (app, desiredOpts = defaultOptions) => {
  const opts = {
    ...defaultOptions,
    ...desiredOpts
  };

  const winstonLogger = _createWinstonLogger(opts);

  app.use(httpContext.middleware);
  shortid.worker(process.pid);

  app.use(function (req, res, next) {
    httpContext.ns.bindEmitter(req);
    httpContext.ns.bindEmitter(res);
    // Assign a unique identifier to each request or reuse parent id if it's an internal request
    let reqId = null;
    if (req.headers['dm-logger-req-id']) {
      reqId = req.headers['dm-logger-req-id'];
    } else {
      reqId = shortid.generate();
    }
    httpContext.set('reqId', reqId);
      
    // set the req-id to every Hermes response
    res.setHeader('dm-logger-req-id', reqId);

    // Manually log each request with the right severity level
    if (isAnAssetRequest(req, opts.assetsPathRegex)) {
      winstonLogger.debug(null, { 'req': req });
    } else {
      winstonLogger.notice(null, { 'req': req });
    }

    next();
  });

  if (opts.getLogLevelFromQuerystring) {
    app.use(_buildLoggerLevelSetterFromQueryStringMiddleware(winstonLogger));
  }

  /* Create a stream object with a 'write' function that will be used by `morgan`
     to log *responses* through Winston, so the output will be picked up by every
     Winston's transport. */
  app.use(morgan('":method :url" :status', {
    skip: (req, res) => { return isAnAssetRequest(req, opts.assetsPathRegex); },
    stream: {
      write: function (message, encoding) {
        winstonLogger.notice(message.trim(), { 'isFromMorgan': true });
      }
    }
  }));

  app.use(morgan('":method :url" :status', {
    skip: (req, res) => { return !isAnAssetRequest(req, opts.assetsPathRegex); },
    stream: {
      write: function (message, encoding) {
        winstonLogger.info(message.trim(), { 'isFromMorgan': true });
      }
    }
  }));

  if (opts.clientMsgTrackerPath) {
    app.post(opts.clientMsgTrackerPath, function (req, res) {
      _collectRequestData(req, result => {
        try {
          const msg = result.msg;
          const severity = result.severity || level;
  
          winstonLogger[severity](msg);
        } catch (error) {
          winstonLogger.error(error); 
        }
        finally {
          res.sendStatus(204);
        }
      });
    });
  }

  return winstonLogger;
};

function _collectRequestData(request, callback) {
  const FORM_URLENCODED = 'application/x-www-form-urlencoded';
  if(request.headers['content-type'] === FORM_URLENCODED) {
    let body = '';
    request.on('data', chunk => {
      body += chunk.toString();
    });
    request.on('end', () => {
      callback(parse(body));
    });
  }
  else {
    callback(null);
  }
}

function isAnAssetRequest (req, assetsPathRegex) {
  if (!assetsPathRegex) {
    return false;
  }

  try {
    return req.originalUrl.match(assetsPathRegex) !== null;
  }
  catch(err) {
    console.log(err)
  }

  return false;
}

function _buildLoggerLevelSetterFromQueryStringMiddleware (winstonLogger) {
  return function (req, res, next) {
    const desiredLogLevel = req.query.set_log_level;
    try {
      if (desiredLogLevel && desiredLogLevel !== level) {
        _.each(winstonLogger.transports, (transport, idx) => {
          transport.level = desiredLogLevel;
        });
        level = desiredLogLevel;
        winstonLogger.notice(`All transports (${winstonLogger.transports.length}) were set to '${desiredLogLevel}' level.`);
      }
    } catch (err) {
      console.log(`Some error was ocurred during 'set_log_level=${desiredLogLevel}' execution.: ${err}`);
    }
  
    next();
  };
}

function _colorize (wantToBeInColor) {
  if (wantToBeInColor) {
    return winston.format.colorize();
  } else {
    // return a do-anything formatter
    return winston.format(info => { return info; })();
  }
}

function _createWinstonLogger (opts) {
  const logger = winston.createLogger({
    format: winston.format.combine(
      _colorize(opts.colorize),
      winston.format.timestamp({
        // format using fecha module -> https://www.npmjs.com/package/fecha
        'format': 'YYYY-MM-DDTHH:mm:ss.SSSZ' // +0000 as hardcoded in morgan's clfdate function
      }),
      winston.format.printf((info) => {
        if (info.isFromMorgan) {
          return `[${info.timestamp}] ${info.level}: <- [${httpContext.get('reqId') || '-'}] ${info.message}`;
        } else {
          if (info.req) {
            return `[${info.timestamp}] ${info.level}: -> [${httpContext.get('reqId') || '-'}] "${info.req.method} ${info.req.originalUrl}" "${info.req.headers['user-agent'] || '-'}"`;
          } else {
            return `[${info.timestamp}] ${info.level}: -- [${httpContext.get('reqId') || '-'}] ${info.message}`;
          }
        }
      })
    ),
    levels: winston.config.syslog.levels,
    level: level,
    transports: [
      new winston.transports.Console({
        // colorize: process.stdout.isTTY,
        handleExceptions: true
      })
    ],
    exitOnError: false
  });

  return logger;
}
