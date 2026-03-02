import express from "express";
import mongoose from  "mongoose";
import "dotenv/config";
import {Log} from "./models/log.js";

const app = express();
const PORT = 3000;

await mongoose.connect(process.env.MONGODB_URI);
console.log("Connected to DB...");

const getTenantUid = ()=>{
   return typeof process.getuid === "function" ? process.getuid() : 1000;
}

app.get("/logs", async(req, res) =>{
    try{
        const tenantUid = getTenantUid();
        const {level , limit = 50} = req.query;
        const query = {tenantUid};
        if(level) query.level = level;
        const logs = await Log.find(query)
        .sort({timestamp: -1})
        .limit(Number(limit));

        res.json(logs);
    }catch(err){
        res.status(500).json({error : err.message});
    }
});

app.get("/health" , (req, res)=>{
    res.json({status : "ok"});
});

app.listen(PORT, ()=>{
    console.log(`Log server running on ${PORT}`);
});