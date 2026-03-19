import express from "express";
import Log from "../models/log.js";

export const router = express.Router();

const getTenantUid = ()=> typeof process.getuid === "function" ? process.getuid() : 1000;

function parseSince(since){
    if(!since) return null;

    const value = parseInt(since);
    const unit = since.slice(-1);
    let ms = 0;
    if(unit === 'm') ms = value * 60 * 1000;
    if(unit === 'h') ms = value * 60 * 60 * 1000;
    if(unit === 'd') ms = value * 24 * 60 * 60 * 1000;
    else return null;
    return new Date(Date.now() - ms);
}
router.get("/", async (req, res)=>{
    try{
        const tenantUid = getTenantUid();
        const {level, limit = 50, since} = req.query;
        const query = {tenantUid};
         const sinceDate = parseSince(since);

        if(level) query.level = level;
        if(sinceDate)  query.timestamp = {$gte : sinceDate};
        const logs = await Log.find(query).sort({timestamp : -1}).limit(Number(limit));
        res.json(logs);
    }
    catch(err){
        console.log("LOG FETCH ERROR : ", err);
        res.status(500).json({error : "Failed to fetch logs"});
    }
});
