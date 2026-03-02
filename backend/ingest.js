import mongoose from "mongoose";
import "dotenv/config";
import {Log} from "./models/log.js";

await mongoose.connect(process.env.MONGODB_URI);

const tenantUid = typeof process.getuid === "function" ? process.getuid() : 1000;


const BATCH_SIZE = 100;

let buffer = [];

process.stdin.setEncoding('utf8');

process.stdin.on("data", async (chunk)=>{
        try{
        const lines = chunk.split("\n");
    
        for(const line of lines){
            const raw = line.trim();
            if(!raw) continue;
    
            let level = "INFO";
            let msg = raw;
            const parts = raw.split(" ");
    
            if(["INFO", "WARN", "DEBUG", "ERROR"].includes(parts[0])){
                level = parts[0]; 
                msg = parts.slice(1).join(" ");
            }
    
            buffer.push({
                tenantUid,
                level: level,
                message: msg,
                service: "demo-service"
            });
            if(buffer.length === BATCH_SIZE){
                await Log.insertMany(buffer);
                buffer = [];
            }
        }
    
        }catch(e){
            console.log("INGESTION ERROR: ", e);
        }
    })
process.stdin.on("end", async ()=>{
    if(buffer.length > 0){
        await Log.insertMany(buffer);
        buffer = [];
    }
    console.log("EXECUTED SUCCESSFULLY!");
    process.exit(0);
})

process.on("SIGINT", async ()=>{
    if(buffer.length > 0){
        console.log(`Saving ${buffer.length} length of logs to the log aggregator...`);
        await Log.insertMany(buffer);
    }
    console.log(`All logs saved successfully !!`);
    console.log(`Exiting......`);
    process.exit(0);

})