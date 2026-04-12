export function getTenantUid() {
    if (typeof process.getuid === "function") {
        return process.getuid();
    }

    const envValue = Number(process.env.TENANT_UID);
    if (!Number.isNaN(envValue) && envValue >= 0) {
        return envValue;
    }

    return 1000;
}
