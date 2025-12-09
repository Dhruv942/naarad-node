const app = require("./app");
const connectDB = require("./config/database");
const cronService = require("./services/cronService");

const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDB();

// Start server
app.listen(PORT, () => {
  console.log("🚀 Naarad backend server is now running");
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);

  // Start cron job (only in production or if explicitly enabled)
  if (
    process.env.ENABLE_CRON === "true" ||
    process.env.NODE_ENV === "production"
  ) {
    console.log("[CRON] Starting cron service...");
    cronService.start();
    console.log("[CRON] Cron service started");
    console.log(
      `[CRON] Interval: ${
        process.env.CRON_INTERVAL || "0 */6 * * *"
      } (every 6 hours)`
    );
  } else {
    console.log(
      "[CRON] Cron service disabled (set ENABLE_CRON=true to enable)"
    );
  }
});
