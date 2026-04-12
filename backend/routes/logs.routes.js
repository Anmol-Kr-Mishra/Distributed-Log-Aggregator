import express from "express";
import { Log } from "../models/log.js";
import { getTenantUid } from "../utils/tenant.js";
import mongoose from "mongoose";

export const router = express.Router();

const LOG_LEVELS = ["INFO", "WARN", "ERROR", "DEBUG"];
const STREAM_MIN_INTERVAL_MS = 500;
const STREAM_MAX_INTERVAL_MS = 10000;
const STREAM_DEFAULT_INTERVAL_MS = 2000;
const STREAM_HEARTBEAT_MS = 15000;

function parseStreamInterval(value) {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
        return STREAM_DEFAULT_INTERVAL_MS;
    }

    return Math.min(Math.max(parsed, STREAM_MIN_INTERVAL_MS), STREAM_MAX_INTERVAL_MS);
}

function parseStreamCursorId(value) {
    if (!value || !mongoose.isValidObjectId(value)) {
        return null;
    }

    return new mongoose.Types.ObjectId(value);
}

function parseSince(since) {
    if (!since) {
        return null;
    }

    const isoDate = new Date(since);
    if (!Number.isNaN(isoDate.getTime())) {
        return isoDate;
    }

    const match = String(since).match(/^(\d+)([mhd])$/);
    if (!match) {
        return null;
    }

    const value = Number(match[1]);
    const unit = match[2];
    let ms = 0;

    if (unit === "m") {
        ms = value * 60 * 1000;
    } else if (unit === "h") {
        ms = value * 60 * 60 * 1000;
    } else if (unit === "d") {
        ms = value * 24 * 60 * 60 * 1000;
    }

    return new Date(Date.now() - ms);
}

function parseLimit(limit){
    const parsed = Number(limit);
    if(Number.isNaN(parsed) || parsed <= 0) return 50;
    return Math.min(parsed, 200);
}

function parsePage(page) {
    const parsed = Number(page);
    if (Number.isNaN(parsed) || parsed <= 0) {
        return 1;
    }

    return parsed;
}

function getQueryFromRequest(req) {
    const tenantUid = getTenantUid();
    const level = req.query.level;
    const since = req.query.since;
    const service = req.query.service;
    const query = { tenantUid };
    let sinceDate = null;

    if (since) {
        sinceDate = parseSince(since);
    }

    if (level) {
        if (LOG_LEVELS.indexOf(level) === -1) {
            return { error: "Invalid log level" };
        }
        query.level = level;
    }

    if (service) {
        query.service = service;
    }

    if (sinceDate) {
        query.timestamp = { $gte: sinceDate };
    }

    return { query: query, sinceDate: sinceDate };
}

router.get("/", async (req, res)=>{
    try{
        const parsed = getQueryFromRequest(req);
        if (parsed.error) {
            return res.status(400).json({ error: parsed.error });
        }

        const query = parsed.query;
        const limit = parseLimit(req.query.limit);
        const page = parsePage(req.query.page);
        const skip = (page - 1) * limit;

        const logs = await Log.find(query).sort({ timestamp: -1 }).skip(skip).limit(limit);
        const total = await Log.countDocuments(query);

        res.json({
            data: logs,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    }
    catch(err){
        console.log("LOG FETCH ERROR : ", err);
        res.status(500).json({error : "Failed to fetch logs"});
    }
});

router.get("/stats", async (req, res)=>{
    try {
        const parsed = getQueryFromRequest(req);
        if (parsed.error) {
            return res.status(400).json({ error: parsed.error });
        }

        const query = parsed.query;
        const stats = await Log.aggregate([
            { $match: query },
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

router.get("/stream", async (req, res) => {
    const parsed = getQueryFromRequest(req);
    if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
    }

    const intervalMs = parseStreamInterval(req.query.intervalMs);
    let cursorId = parseStreamCursorId(req.query.cursorId);
    let closed = false;
    let pollTimer = null;
    let heartbeatTimer = null;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    function closeStream() {
        closed = true;

        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }

        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }

    function schedulePoll() {
        if (closed) {
            return;
        }

        pollTimer = setTimeout(pollForLogs, intervalMs);
    }

    async function pollForLogs() {
        if (closed) {
            return;
        }

        try {
            const query = { ...parsed.query };
            if (cursorId) {
                query._id = { $gt: cursorId };
            }

            const logs = await Log.find(query).sort({ _id: 1 }).limit(200).lean();

            if (logs.length > 0) {
                cursorId = logs[logs.length - 1]._id;
                res.write("event: logs\\n");
                res.write("data: " + JSON.stringify({
                    count: logs.length,
                    cursorId: String(cursorId),
                    logs: logs
                }) + "\\n\\n");
            }
        } catch (err) {
            res.write("event: error\\n");
            res.write("data: " + JSON.stringify({ message: "Stream query failed" }) + "\\n\\n");
        } finally {
            schedulePoll();
        }
    }

    heartbeatTimer = setInterval(function () {
        if (!closed) {
            res.write(": keep-alive\\n\\n");
        }
    }, STREAM_HEARTBEAT_MS);

    res.write("event: ready\\n");
    res.write("data: " + JSON.stringify({
        intervalMs: intervalMs,
        cursorId: cursorId ? String(cursorId) : null
    }) + "\\n\\n");

    schedulePoll();

    req.on("close", function () {
        closeStream();
    });
});

router.get("/stats/services", async (req, res) => {
    try {
        const parsed = getQueryFromRequest(req);
        if (parsed.error) {
            return res.status(400).json({ error: parsed.error });
        }

        const query = parsed.query;
        const stats = await Log.aggregate([
            { $match: query },
            { $group: { _id: "$service", count: { $sum: 1 } } },
            { $project: { _id: 0, service: "$_id", count: 1 } },
            { $sort: { count: -1, service: 1 } }
        ]);

        res.json(stats);
    } catch (err) {
        console.log("LOG SERVICE STATS ERROR : ", err);
        res.status(500).json({ error: "Failed to fetch service stats" });
    }
});

router.get("/stats/timeline", async (req, res) => {
    try {
        const parsed = getQueryFromRequest(req);
        if (parsed.error) {
            return res.status(400).json({ error: parsed.error });
        }

        const query = parsed.query;
        const sinceDate = parsed.sinceDate;
        let groupFormat = "%Y-%m-%dT%H:00";

        if (sinceDate && (Date.now() - sinceDate.getTime()) > 24 * 60 * 60 * 1000) {
            groupFormat = "%Y-%m-%d";
        }

        const timeline = await Log.aggregate([
            { $match: query },
            {
                $group: {
                    _id: {
                        bucket: {
                            $dateToString: {
                                format: groupFormat,
                                date: "$timestamp"
                            }
                        },
                        level: "$level"
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $project: {
                    _id: 0,
                    bucket: "$_id.bucket",
                    level: "$_id.level",
                    count: 1
                }
            },
            { $sort: { bucket: 1, level: 1 } }
        ]);

        res.json(timeline);
    } catch (err) {
        console.log("LOG TIMELINE STATS ERROR : ", err);
        res.status(500).json({ error: "Failed to fetch timeline stats" });
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
