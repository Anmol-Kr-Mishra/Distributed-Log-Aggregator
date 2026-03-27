import express from "express";
import { Log } from "../models/log.js";

export const router = express.Router();

const getTenantUid = ()=> typeof process.getuid === "function" ? process.getuid() : 1000;
const LOG_LEVELS = ["INFO", "WARN", "ERROR", "DEBUG"];

function parseSince(since){
    if(!since) return null;

    const value = parseInt(since);
    const unit = since.slice(-1);
    let ms = 0;
    if(unit === 'm') ms = value * 60 * 1000;
    else if(unit === 'h') ms = value * 60 * 60 * 1000;
    else if(unit === 'd') ms = value * 24 * 60 * 60 * 1000;
    else return null;
    return new Date(Date.now() - ms);
};

function parseLimit(limit){
    const parsed = Number(limit);
    if(Number.isNaN(parsed) || parsed <= 0) return 50;
    return Math.min(parsed, 200);
}

router.get("/", async (req, res)=>{
    try{
        const tenantUid = getTenantUid();
        const {level, limit = 50, since} = req.query;
        const query = {tenantUid};
        const sinceDate = parseSince(since);

        if(level){
            if(!LOG_LEVELS.includes(level)){
                return res.status(400).json({error : "Invalid log level"});
            }
            query.level = level;
        }
        if(sinceDate)  query.timestamp = {$gte : sinceDate};
        const logs = await Log.find(query).sort({timestamp : -1}).limit(parseLimit(limit));
        res.json(logs);
    }
    catch(err){
        console.log("LOG FETCH ERROR : ", err);
        res.status(500).json({error : "Failed to fetch logs"});
    }
});

router.get("/stats", async (req, res)=>{
    try {
        const tenantUid = getTenantUid();
        const stats = await Log.aggregate([
            { $match: { tenantUid } },
            { $group: { _id: "$level", count: { $sum: 1 } } },
            { $project: { _id: 0, level: "$_id", count: 1 } },
            { $sort: { level: 1 } }
        ]);

        res.json(stats);
    }
    catch (err) {
        console.log("LOG STATS ERROR : ", err);
        res.status(500).json({error : "Failed to fetch log stats"});
    }
});

router.get("/services", async (req, res)=>{
    try {
        const tenantUid = getTenantUid();
        const services = await Log.distinct("service", { tenantUid });
        res.json(services.sort());
    }
    catch (err) {
        console.log("LOG SERVICES ERROR : ", err);
        res.status(500).json({error : "Failed to fetch services"});
    }
});

router.get("/:id", async (req, res)=>{
    try {
        const tenantUid = getTenantUid();
        const log = await Log.findOne({ _id: req.params.id, tenantUid });

        if(!log){
            return res.status(404).json({error : "Log not found"});
        }

        res.json(log);
    }
    catch (err) {
        console.log("LOG BY ID ERROR : ", err);
        res.status(400).json({error : "Invalid log id"});
    }
});

export default router;
