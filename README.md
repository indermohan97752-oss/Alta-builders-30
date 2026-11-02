# Alta-builders-30
# 💬 Real-Time Campus Chat App

A full-stack, real-time room-based chat application built to enable instant messaging, channel-based collaboration, and live user interaction for campus communities and project teams.

---

## 📌 Project Overview
Communication during group projects and campus activities often gets lost across disjointed tools. This app provides a focused environment where users can create or join public chat rooms, exchange messages instantly without refreshing the page, view active members, track typing status, and load historic room conversations effortlessly.

Built as part of the **ALTA BUILDER 30 Challenge** (Track A: Full-Stack Product).

---

## ✨ Features

### 🛡️ Core MVP Features
- **User Authentication:** Registration & Login secured with hashed passwords (`bcrypt`) and JSON Web Tokens (`JWT`).
- **User Profiles:** Profile setup with customizable display names, bios, and avatars.
- **Room Management:** Create, view, search, and join public chat rooms.
- **Message History & Persistence:** Chat logs stored safely in the database and automatically retrieved upon joining a room.
- **Real-Time WebSockets:** Instant bidirectional messaging powered by Socket.io.
- **Live User Status & Indicators:** Real-time online member status and active typing indicators.

---

## 🛠️ Tech Stack

- **Frontend:** React.js, Tailwind CSS / HTML5, Axios, Socket.io-client
- **Backend:** Node.js, Express.js, Socket.io
- **Database:** MongoDB / PostgreSQL
- **Authentication:** JWT, bcrypt
- **Testing & Tooling:** Postman, Jest / Supertest

---

## 📁 Repository Structure

```text
├── backend/
│   ├── config/         # Database and server config
│   ├── controllers/    # API request handlers
│   ├── middleware/     # Auth & validation middleware
│   ├── models/         # Database schemas (User, Room, Message)
│   ├── routes/         # Express API endpoints
│   ├── sockets/        # Socket.io event handlers
│   ├── .env.example    # Environment variable templates
│   └── server.js       # App entry point
├── frontend/
│   ├── src/
│   │   ├── components/ # Reusable UI elements
│   │   ├── context/    # React Auth & Socket Context
│   │   ├── pages/      # Login, Signup, Chat, Dashboard pages
│   │   └── utils/      # API helpers
│   └── package.json
├── docs/               # Wireframes and Schema diagrams
├── FEATURES.md         # Detailed breakdown of MVP & future scope
└── README.md
