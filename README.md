# dm-logger (aka Traceability Logger)
Just another logger lib with some toppings over it.

It's a NodeJS module to generate centralized logs of different sources (most of the time, microservices) adding client requests traceability. It use Winston and Morgan modules under the hood but add a layer of services to provide a common highly-customizable format which includes type of signal (request/response), timestamps, ip address, user agent and most important, short non-sequential url-friendly unique ids that let you “follow” the client activity from the first request done to any service until it leaves.

You can see more about it here:
* https://dariomac.com/content-distribution-system
* https://dariomac.com/traceability-logger
* https://dariomac.com/nodejs-logging-solutions
