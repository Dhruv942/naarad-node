const http = require("http");
const { Server } = require("socket.io");
const app = require("./app"); 
const connectDB = require("./config/database");
const cronService = require("./services/cronService");

const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDB();

// Start server
const server = http.createServer(app);
const { setIo } = require("./socket");

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://192.168.1.4:3001",
  "http://192.168.1.4:3000"
];

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      console.log("Origin requesting access:", origin); // Debug log
      if (!origin || allowedOrigins.some(allowedOrigin => 
        origin.startsWith(allowedOrigin.replace(/\*$/, ''))
      )) {
        callback(null, true);
      } else {
        console.log("CORS blocked for origin:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  allowEIO3: true, // For Socket.IO v3+ compatibility
  transports: ['websocket', 'polling'] // Enable both transports
});

// Add CORS headers for regular HTTP requests
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

setIo(io);

io.on("connection", (socket) => {
  console.log(`⚡: ${socket.id} user just connected!`);
  socket.on("disconnect", () => {
    console.log("🔥: A user disconnected");
  });
});

server.listen(PORT, () => {
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
        process.env.CRON_INTERVAL || "0 9 * * *"
      } (daily at 9:00 AM)`
    );
  } else {
    console.log(
      "[CRON] Cron service disabled (set ENABLE_CRON=true to enable)"
    );
  }
});
