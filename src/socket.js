let io = null;

const setIo = (socketIoInstance) => {
  io = socketIoInstance;
};

const getIo = () => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
};

module.exports = { setIo, getIo };
