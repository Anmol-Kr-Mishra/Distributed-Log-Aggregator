import mongoose from "mongoose";
const logSchema = new mongoose.Schema({
    tenantUid:{
        type: Number,
        required: true,
       
    },
    timestamp:{
        type: Date,
        default: Date.now,
        
    },
    level:{
        type: String,
        enum: ["INFO", "WARN", "ERROR", "DEBUG"],
        default: "INFO"
    },
    message:{
        type: String,
        required: true
    },
    service: {
        type: String,
        required: true
    }
});

logSchema.index({tenantUid : 1, timestamp : -1});
logSchema.index({tenantUid : 1, level: 1});

export const Log = mongoose.model("Log", logSchema);