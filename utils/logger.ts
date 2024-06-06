import winston from "winston";

const logger = winston.createLogger({
  transports: [new winston.transports.Console()],
});

if (process.env.LOGGER_LEVEL) {
  logger.level = process.env.LOGGER_LEVEL;
}

export { logger };
