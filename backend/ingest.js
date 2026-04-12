import mongoose from "mongoose";
import "dotenv/config";
import { Log } from "./models/log.js";
import { getTenantUid } from "./utils/tenant.js";

const LOG_LEVELS = ["INFO", "WARN", "ERROR", "DEBUG"];
const BATCH_SIZE = Number(process.env.INGEST_BATCH_SIZE) || 500;
const FLUSH_INTERVAL_MS = Number(process.env.INGEST_FLUSH_INTERVAL_MS) || 2000;
const tenantUid = getTenantUid();
let buffer = [];
let inserted = 0;
let pendingWrite = false;
let hasFailed = false;
let partialLine = "";
let pendingExitCode = null;
let flushTimer = null;

function clearFlushTimer() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
}

function scheduleFlush() {
    if (pendingExitCode !== null || flushTimer || hasFailed || buffer.length === 0) {
        return;
    }

    flushTimer = setTimeout(function () {
        flushTimer = null;
        flushBuffer();
    }, FLUSH_INTERVAL_MS);
}

function getServiceName() {
    const arg = process.argv.find((item) => item.startsWith("--service="));
    const fromArg = arg ? arg.split("=")[1]?.trim() : "";
    const fromEnv = process.env.SERVICE_NAME?.trim() ?? "";
    return fromArg || fromEnv || "unknown-service";
}

function normalizeLevel(value) {
    if (!value) {
        return "INFO";
    }

    const upper = String(value).toUpperCase();
    if (LOG_LEVELS.indexOf(upper) >= 0) {
        return upper;
    }

    return "INFO";
}

function parseLogLine(rawLine, service) {
    const raw = rawLine.trim();
    if (!raw) {
        return null;
    }

    try {
        const payload = JSON.parse(raw);
        if (payload && typeof payload === "object" && payload.message) {
            let parsedDate = new Date();
            if (payload.timestamp) {
                const tempDate = new Date(payload.timestamp);
                if (!Number.isNaN(tempDate.getTime())) {
                    parsedDate = tempDate;
                }
            }

            return {
                tenantUid: tenantUid,
                service: payload.service || service,
                level: normalizeLevel(payload.level),
                message: String(payload.message),
                timestamp: parsedDate
            };
        }
    } catch (e) {
        console.log("Error : Parsing Logs");
    }

    const withTimestamp = raw.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s+(INFO|WARN|ERROR|DEBUG)\s+(.+)$/);
    if (withTimestamp) {
        return {
            tenantUid: tenantUid,
            service: service,
            level: normalizeLevel(withTimestamp[2]),
            message: withTimestamp[3],
            timestamp: new Date(withTimestamp[1])
        };
    }

    const withLevel = raw.match(/^(INFO|WARN|ERROR|DEBUG)\s+(.+)$/);
    if (withLevel) {
        return {
            tenantUid: tenantUid,
            service: service,
            level: normalizeLevel(withLevel[1]),
            message: withLevel[2],
            timestamp: new Date()
        };
    }

    return {
        tenantUid: tenantUid,
        service: service,
        level: "INFO",
        message: raw,
        timestamp: new Date()
    };
}

function addLineToBuffer(line, serviceName) {
    const parsed = parseLogLine(line, serviceName);
    if (!parsed) {
        return;
    }

    buffer.push(parsed);
    scheduleFlush();
}

async function flushBuffer(forceExitCode) {
    if (typeof forceExitCode === "number") {
        pendingExitCode = forceExitCode;
    }

    clearFlushTimer();

    if (pendingWrite || buffer.length === 0) {
        if (!pendingWrite && pendingExitCode !== null) {
            await mongoose.disconnect();
            process.exit(pendingExitCode);
        }
        return;
    }

    pendingWrite = true;
    const docs = buffer;
    buffer = [];

    try {
        await Log.insertMany(docs, { ordered: false });
        inserted = inserted + docs.length;
        pendingWrite = false;

        if (pendingExitCode !== null) {
            console.log("Ingestion completed. Inserted " + inserted + " logs.");
            await mongoose.disconnect();
            process.exit(pendingExitCode);
            return;
        }

        if (buffer.length > 0) {
            scheduleFlush();
        }
    } catch (error) {
        hasFailed = true;
        console.error("Ingestion error:", error.message);
        await mongoose.disconnect();
        process.exit(1);
    }
}

function processChunk(chunk, serviceName) {
    partialLine = partialLine + chunk;
    const lines = partialLine.split("\n");
    partialLine = lines.pop() || "";

    for (let i = 0; i < lines.length; i++) {
        addLineToBuffer(lines[i], serviceName);
    }
}

function stopIngest(exitCode) {
    if (hasFailed) {
        return;
    }

    clearFlushTimer();

    if (partialLine.trim().length > 0) {
        addLineToBuffer(partialLine, serviceName);
        partialLine = "";
    }

    flushBuffer(exitCode);
}

await mongoose.connect(process.env.MONGODB_URI);

const serviceName = getServiceName();
console.log(`Ingestor started for service: ${serviceName} and tenant: ${tenantUid}`);

process.stdin.setEncoding("utf8");

process.stdin.on("data", function (chunk) {
    if (hasFailed) {
        return;
    }

    processChunk(chunk, serviceName);
    if (buffer.length >= BATCH_SIZE) {
        flushBuffer();
    }
});

process.stdin.on("end", function () {
    stopIngest(0);
});

process.stdin.on("error", async function (error) {
    hasFailed = true;
    console.error("Input stream error:", error.message);
    await mongoose.disconnect();
    process.exit(1);
});

process.on("SIGINT", async () => {
    stopIngest(0);
});