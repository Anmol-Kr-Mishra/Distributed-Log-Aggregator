import mongoose from "mongoose";
import "dotenv/config";

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected");
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
