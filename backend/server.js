import express from "express";
import mongoose from  "mongoose";
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logsRoutes from "./routes/logs.routes.js";
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPath = path.join(__dirname, "public");

await mongoose.connect(process.env.MONGODB_URI);
console.log("Connected to DB...");

app.use(express.json());
app.use(express.static(publicPath));
app.use('/logs', logsRoutes);
app.use('/api/logs', logsRoutes);

app.get("/dashboard", (req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
});

app.get("/health" , (req, res)=>{
    res.json({status : "ok"});
});

app.listen(PORT, ()=>{
    console.log(`Log server running on ${PORT}`);
});