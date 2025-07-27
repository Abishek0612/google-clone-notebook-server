const performanceMiddleware = (req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`
    );

    if (duration > 5000) {
      console.warn(`⚠️  Slow request detected: ${req.path} took ${duration}ms`);
    }
  });

  next();
};

module.exports = performanceMiddleware;
