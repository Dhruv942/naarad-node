const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const alertRoutes = require("./routes/alertRoutes");
const newsRoutes = require("./routes/newsRoutes");
const watiRoutes = require("./routes/watiRoutes");
const cronRoutes = require("./routes/cronRoutes");

const app = express();

// Middleware
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://192.168.1.4:3001",
];

const corsOptions = {
  origin: (origin, callback) => {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic startup log for Naarad app initialization
console.log("✅ Initializing Naarad Express app...");

// Health check route
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use("/auth", authRoutes);
app.use("/alerts", alertRoutes);
app.use("/news", newsRoutes);
app.use("/wati", watiRoutes);
app.use("/cron", cronRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
    error: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

module.exports = app;
