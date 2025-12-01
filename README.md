# Naarad Backend

A Node.js backend API with Express.js and MongoDB for user authentication and management.

## Features

- User login/registration endpoint
- MongoDB integration with unique phone number constraint
- WATI WhatsApp integration for welcome messages
- Production-ready project structure
- Input validation
- Error handling

## Project Structure

```
naaradbackend/
├── src/
│   ├── config/
│   │   └── database.js          # MongoDB connection
│   ├── controllers/
│   │   └── authController.js    # Auth business logic
│   ├── middleware/
│   │   └── validation.js        # Input validation
│   ├── models/
│   │   └── User.js              # User schema/model
│   ├── routes/
│   │   └── authRoutes.js        # Auth routes
│   ├── services/
│   │   └── watiService.js       # WATI WhatsApp service
│   ├── app.js                   # Express app setup
│   └── server.js                # Server entry point
├── .env.example                 # Environment variables template
├── .gitignore
├── package.json
└── README.md
```

## Installation

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

3. Update `.env` with your configuration:

```env
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/naarad_db
WATI_API_ENDPOINT=https://api.wati.io/integration/v1
WATI_API_TOKEN=your_wati_api_token_here
WATI_TEMPLATE_NAME=welcome_template
```

4. Make sure MongoDB is running locally:

```bash
# If using MongoDB locally
mongod
```

## Running the Server

### Development (with auto-reload):

```bash
npm run dev
```

### Production:

```bash
npm start
```

The server will start on `http://localhost:3000` (or the port specified in `.env`).

## API Endpoints

### POST /auth/login

Login or register a user.

**Request Body:**

```json
{
  "country_code": "+91",
  "phone_number": "9876543210",
  "email": "user@gmail.com"
}
```

**Response (Existing User):**

```json
{
  "success": true,
  "data": {
    "user_id": "existing-uuid",
    "country_code": "+91",
    "phone_number": "9876543210",
    "email": "user@gmail.com"
  }
}
```

**Response (New User):**

```json
{
  "success": true,
  "data": {
    "user_id": "new-uuid",
    "country_code": "+91",
    "phone_number": "9876543210",
    "email": "user@gmail.com"
  }
}
```

**Error Response:**

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [...]
}
```

### GET /health

Health check endpoint.

**Response:**

```json
{
  "success": true,
  "message": "Server is running",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Login Logic

1. Checks if user exists by `country_code + phone_number` combination
2. **If existing user:**
   - Updates email if it has changed
   - Returns existing `user_id` (no welcome message)
3. **If new user:**
   - Creates new user with UUID `user_id`
   - Sends welcome WhatsApp message via WATI (async, non-blocking)
   - Returns new `user_id`

## Database

- **Collection:** `users_collection`
- **Unique Constraint:** `country_code + phone_number` combination
- **Fields:**
  - `user_id` (String, UUID, unique)
  - `country_code` (String, required)
  - `phone_number` (String, required)
  - `email` (String, required)
  - `createdAt` (Date, auto)
  - `updatedAt` (Date, auto)

## Environment Variables

| Variable             | Description               | Default            |
| -------------------- | ------------------------- | ------------------ |
| `PORT`               | Server port               | `3000`             |
| `NODE_ENV`           | Environment               | `development`      |
| `MONGODB_URI`        | MongoDB connection string | Required           |
| `WATI_API_ENDPOINT`  | WATI API endpoint         | Required           |
| `WATI_API_TOKEN`     | WATI API token            | Required           |
| `WATI_TEMPLATE_NAME` | WATI template name        | `welcome_template` |

## Technologies

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **MongoDB** - Database
- **Mongoose** - MongoDB ODM
- **express-validator** - Input validation
- **axios** - HTTP client for WATI API
- **uuid** - UUID generation
- **dotenv** - Environment variables

## License

ISC
# naarad-node
