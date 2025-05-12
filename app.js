const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Cache storage for remotes
const remoteCache = {
    data: new Map(),
    lastUpdated: null,
    updateInProgress: false,
    updateStartTime: null
};

// NEW: Cache storage for local directories
const localCache = {
    data: new Map(),
    lastUpdated: null,
    updateInProgress: false,
    updateStartTime: null
};

// Temporary cache storage for remotes during updates
const remoteCacheTemp = {
    data: new Map()
};

// Temporary cache storage for local directories during updates
const localCacheTemp = {
    data: new Map()
};

// NEW: Structure to track size history for last modified detection
const localSizeHistory = {
    data: new Map() // Map<directoryPath, Array<{timestamp, bytes}>>
};

// Middleware to parse JSON bodies
app.use(express.json());

/**
 * Utility function to get directory size recursively
 * @param {string} directoryPath - Path of the directory to measure
 * @returns {Promise<number>} - Size of the directory in bytes
 */
function getDirectorySize(directoryPath) {
    return new Promise((resolve, reject) => {
        let totalSize = 0;

        try {
            const files = fs.readdirSync(directoryPath);

            let processed = 0;
            if (files.length === 0) {
                resolve(0);
                return;
            }

            files.forEach(file => {
                const filePath = path.join(directoryPath, file);
                const stats = fs.statSync(filePath);

                if (stats.isDirectory()) {
                    // Handle directories recursively
                    getDirectorySize(filePath)
                        .then(size => {
                            totalSize += size;
                            processed++;

                            if (processed === files.length) {
                                resolve(totalSize);
                            }
                        })
                        .catch(reject);
                } else {
                    // Add file size
                    totalSize += stats.size;
                    processed++;

                    if (processed === files.length) {
                        resolve(totalSize);
                    }
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Get all available rclone remotes
 * @returns {Promise<string[]>} - List of available remotes
 */
function getAvailableRemotes() {
    return new Promise((resolve, reject) => {
        exec('rclone listremotes', (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }

            // Parse remote names (removing trailing colon)
            const remotes = stdout.split('\n')
                .filter(line => line.trim().length > 0)
                .map(remote => remote.trim().replace(/:$/, ''));

            resolve(remotes);
        });
    });
}

/**
 * Run rclone size command and get the result
 * @param {string} remotePath - rclone remote path to measure
 * @returns {Promise<object>} - Size information including bytes, count, and error if any
 */
function getRcloneSize(remotePath) {
    return new Promise((resolve, reject) => {
        exec(`rclone size "${remotePath}" --json`, (error, stdout, stderr) => {
            if (error) {
                resolve({
                    error: error.message,
                    stdout,
                    stderr
                });
                return;
            }

            try {
                const result = JSON.parse(stdout);
                resolve(result);
            } catch (parseError) {
                resolve({
                    error: `Failed to parse rclone output: ${parseError.message}`,
                    stdout,
                    stderr
                });
            }
        });
    });
}

/**
 * Format bytes to human-readable format
 * @param {number} bytes - Bytes to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} - Formatted string
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Update the cache with size information for all available remotes
 * @returns {Promise<void>}
 */
async function updateRemoteCache() {
    try {
        // Initialize temporary cache
        remoteCacheTemp.data = new Map(remoteCache.data);
        const startTime = new Date();
        console.log(`[REMOTE_CACHE] Starting cache update at ${startTime.toISOString()}`);
        console.log(`[REMOTE_CACHE] Retrieving list of available remotes...`);

        const remotes = await getAvailableRemotes();
        console.log(`[REMOTE_CACHE] Found ${remotes.length} remotes: ${remotes.join(', ')}`);

        // Process each remote
        for (let i = 0; i < remotes.length; i++) {
            const remote = remotes[i];
            const remotePath = `${remote}:`;

            const remoteStartTime = new Date();
            console.log(`[REMOTE_CACHE] (${i+1}/${remotes.length}) Starting size calculation for ${remotePath} at ${remoteStartTime.toISOString()}`);

            try {
                console.log(`[REMOTE_CACHE] Running rclone size command for ${remotePath} - this may take a while...`);
                const sizeInfo = await getRcloneSize(remotePath);

                const remoteEndTime = new Date();
                const durationMs = remoteEndTime - remoteStartTime;
                const durationSec = (durationMs / 1000).toFixed(2);

                if (!sizeInfo.error) {
                    remoteCacheTemp.data.set(remotePath, {
                        bytes: sizeInfo.bytes || 0,
                        count: sizeInfo.count || 0,
                        timestamp: new Date().toISOString(),
                        calculationDurationMs: durationMs
                    });

                    console.log(`[REMOTE_CACHE] ✓ Updated cache for ${remotePath}: ${formatBytes(sizeInfo.bytes || 0)}, ${sizeInfo.count || 0} objects, took ${durationSec}s`);
                } else {
                    console.error(`[REMOTE_CACHE] ✗ Error getting size for ${remotePath} after ${durationSec}s:`, sizeInfo.error);
                    if (sizeInfo.stderr) {
                        console.error(`[REMOTE_CACHE] stderr: ${sizeInfo.stderr}`);
                    }
                }
            } catch (remoteError) {
                const remoteEndTime = new Date();
                const durationSec = ((remoteEndTime - remoteStartTime) / 1000).toFixed(2);
                console.error(`[REMOTE_CACHE] ✗ Failed to process remote ${remote} after ${durationSec}s:`, remoteError);
            }
        }

        const endTime = new Date();
        const totalDurationSec = ((endTime - startTime) / 1000).toFixed(2);

        remoteCache.lastUpdated = endTime.toISOString();
        console.log(`[REMOTE_CACHE] Remote cache update completed at ${endTime.toISOString()}`);
        console.log(`[REMOTE_CACHE] Total update duration: ${totalDurationSec}s for ${remotes.length} remotes`);
        console.log(`[REMOTE_CACHE] Cache now contains ${remoteCache.data.size} entries`);

        // Log a summary of the cached data
        console.log(`[REMOTE_CACHE] Cache summary:`);
        for (const [path, data] of remoteCache.data.entries()) {
            const duration = data.calculationDurationMs ?
                `${(data.calculationDurationMs / 1000).toFixed(2)}s` : 'unknown';
            console.log(`[REMOTE_CACHE]   - ${path}: ${formatBytes(data.bytes)}, ${data.count} objects, calculation took ${duration}`);
        }
    } catch (error) {
        console.error(`[REMOTE_CACHE] Failed to update remote cache:`, error);
    } finally {
        // Replace the main cache with the temporary cache all at once
        remoteCache.data = new Map(remoteCacheTemp.data);
        remoteCacheTemp.data.clear();
        remoteCache.updateInProgress = false;
        remoteCache.updateStartTime = null;
    }
}

/**
 * NEW: Update the cache with size information for all tracked local directories
 * @returns {Promise<void>}
 */
async function updateLocalCache() {
    try {
        if (localCache.data.size === 0) {
            console.log(`[LOCAL_CACHE] No local directories to update in cache`);
            return;
        }

        const startTime = new Date();
        console.log(`[LOCAL_CACHE] Starting cache update at ${startTime.toISOString()}`);
        console.log(`[LOCAL_CACHE] Found ${localCache.data.size} directories to update`);

        const localDirs = Array.from(localCache.data.keys());

        // Process each directory
        for (let i = 0; i < localDirs.length; i++) {
            const localDir = localDirs[i];

            const dirStartTime = new Date();
            console.log(`[LOCAL_CACHE] (${i+1}/${localDirs.length}) Starting size calculation for ${localDir} at ${dirStartTime.toISOString()}`);

            try {
                if (!fs.existsSync(localDir)) {
                    console.error(`[LOCAL_CACHE] ✗ Directory no longer exists: ${localDir}`);
                    // Keep the entry but mark it as inaccessible
                    localCache.data.set(localDir, {
                        ...localCache.data.get(localDir),
                        error: 'Directory no longer exists',
                        timestamp: new Date().toISOString()
                    });
                    continue;
                }

                console.log(`[LOCAL_CACHE] Calculating size for ${localDir} - this may take a while...`);
                const sizeBytes = await getDirectorySize(localDir);

                const dirEndTime = new Date();
                const durationMs = dirEndTime - dirStartTime;
                const durationSec = (durationMs / 1000).toFixed(2);

                const currentTime = new Date();
                localCacheTemp.data.set(localDir, {
                    bytes: sizeBytes,
                    count: null,
                    timestamp: currentTime.toISOString(),
                    calculationDurationMs: durationMs
                });

                if (!localSizeHistory.data.has(localDir)) {
                    localSizeHistory.data.set(localDir, []);
                }

                const history = localSizeHistory.data.get(localDir);
                const lastEntry = history[history.length - 1];

                if (!lastEntry || lastEntry.bytes !== sizeBytes) {
                    history.push({
                        timestamp: currentTime.toISOString(),
                        bytes: sizeBytes
                    });

                    // Keep only last 30 days of history to prevent memory issues
                    const thirtyDaysAgo = new Date(currentTime - 30 * 24 * 60 * 60 * 1000);
                    const filteredHistory = history.filter(entry =>
                        new Date(entry.timestamp) > thirtyDaysAgo
                    );
                    localSizeHistory.data.set(localDir, filteredHistory);
                }

                console.log(`[LOCAL_CACHE] ✓ Updated cache for ${localDir}: ${formatBytes(sizeBytes)}, took ${durationSec}s`);
            } catch (dirError) {
                const dirEndTime = new Date();
                const durationSec = ((dirEndTime - dirStartTime) / 1000).toFixed(2);
                console.error(`[LOCAL_CACHE] ✗ Failed to process directory ${localDir} after ${durationSec}s:`, dirError);

                // Store the error in the cache
                localCache.data.set(localDir, {
                    ...localCache.data.get(localDir),
                    error: dirError.message,
                    timestamp: new Date().toISOString()
                });
            }
        }

        const endTime = new Date();
        const totalDurationSec = ((endTime - startTime) / 1000).toFixed(2);

        localCache.lastUpdated = endTime.toISOString();
        console.log(`[LOCAL_CACHE] Local cache update completed at ${endTime.toISOString()}`);
        console.log(`[LOCAL_CACHE] Total update duration: ${totalDurationSec}s for ${localCache.data.size} directories`);

        // Log a summary of the cached data
        console.log(`[LOCAL_CACHE] Cache summary:`);
        for (const [dir, data] of localCache.data.entries()) {
            const duration = data.calculationDurationMs ?
                `${(data.calculationDurationMs / 1000).toFixed(2)}s` : 'unknown';
            console.log(`[LOCAL_CACHE]   - ${dir}: ${formatBytes(data.bytes)}, calculation took ${duration}`);
        }
    } catch (error) {
        console.error(`[LOCAL_CACHE] Failed to update local cache:`, error);
    } finally {
        // Replace the main cache with the temporary cache all at once
        localCache.data = new Map(localCacheTemp.data);
        localCacheTemp.data.clear();
        localCache.updateInProgress = false;
        localCache.updateStartTime = null;
    }
}

/**
 * NEW: Add a local directory to the cache
 * @param {string} directoryPath - Path to add to the cache
 * @returns {Promise<object>} - Size information for the directory
 */
async function addToLocalCache(directoryPath) {
    try {
        console.log(`[LOCAL_CACHE] Adding new directory to cache: ${directoryPath}`);

        if (!fs.existsSync(directoryPath)) {
            throw new Error(`Directory does not exist: ${directoryPath}`);
        }

        const startTime = new Date();
        const sizeBytes = await getDirectorySize(directoryPath);
        const endTime = new Date();
        const durationMs = endTime - startTime;

        const dirInfo = {
            bytes: sizeBytes,
            count: null, // We don't track file count for local directories
            timestamp: endTime.toISOString(),
            calculationDurationMs: durationMs
        };

        localCache.data.set(directoryPath, dirInfo);

        if (!localSizeHistory.data.has(directoryPath)) {
            localSizeHistory.data.set(directoryPath, []);
        }
        localSizeHistory.data.get(directoryPath).push({
            timestamp: endTime.toISOString(),
            bytes: sizeBytes
        });

        console.log(`[LOCAL_CACHE] Added ${directoryPath} to cache: ${formatBytes(sizeBytes)}, calculation took ${(durationMs/1000).toFixed(2)}s`);

        return dirInfo;
    } catch (error) {
        console.error(`[LOCAL_CACHE] Failed to add directory to cache:`, error);
        throw error;
    }
}

/**
 * Schedule cache updates every 24 hours
 * @param {boolean} updateNow - Whether to update the cache immediately on start
 */
function scheduleCacheUpdates(updateNow = true) {
    if (updateNow) {
        console.log(`[CACHE] Initial cache update scheduled to run immediately on startup`);
        // Use setTimeout with 0 delay to allow the server to start completely before running the cache update
        setTimeout(() => {
            remoteCache.updateInProgress = true;
            remoteCache.updateStartTime = new Date().toISOString();
            updateRemoteCache().catch(err => {
                console.error(`[REMOTE_CACHE] Initial cache update failed:`, err);
            });

            // Also update local cache initially
            localCache.updateInProgress = true;
            localCache.updateStartTime = new Date().toISOString();
            updateLocalCache().catch(err => {
                console.error(`[LOCAL_CACHE] Initial cache update failed:`, err);
            });
        }, 0);
    } else {
        console.log(`[CACHE] Initial cache update skipped, will run at scheduled interval`);
    }

    // Schedule remote updates every 24 hours
    const remoteUpdateInterval = 24 * 60 * 60 * 1000;
    console.log(`[CACHE] Scheduling remote cache updates every 24 hours (${remoteUpdateInterval}ms)`);

    setInterval(() => {
        const nextUpdateTime = new Date();
        console.log(`[REMOTE_CACHE] Running scheduled cache update at ${nextUpdateTime.toISOString()}`);
        remoteCache.updateInProgress = true;
        remoteCache.updateStartTime = nextUpdateTime.toISOString();
        updateRemoteCache().catch(err => {
            console.error(`[REMOTE_CACHE] Scheduled cache update failed:`, err);
        });
    }, remoteUpdateInterval);

    // Schedule local updates every 1 hour
    const localUpdateInterval = 60 * 60 * 1000;
    console.log(`[CACHE] Scheduling local cache updates every 1 hour (${localUpdateInterval}ms)`);

    setInterval(() => {
        const nextUpdateTime = new Date();
        console.log(`[LOCAL_CACHE] Running scheduled cache update at ${nextUpdateTime.toISOString()}`);
        localCache.updateInProgress = true;
        localCache.updateStartTime = nextUpdateTime.toISOString();
        updateLocalCache().catch(err => {
            console.error(`[LOCAL_CACHE] Scheduled cache update failed:`, err);
        });
    }, localUpdateInterval);
}

/**
 * Get the last modified time when the local directory size changed
 * @param {string} directoryPath - Path to the directory
 * @returns {string|null} - ISO timestamp of last size change, rounded to nearest hour
 */
function getLastModified(directoryPath) {
    const history = localSizeHistory.data.get(directoryPath);
    if (!history || history.length === 0) {
        return null;
    }

    // Find the most recent time when size changed
    for (let i = history.length - 1; i > 0; i--) {
        if (history[i].bytes !== history[i-1].bytes) {
            // Round to the nearest hour
            const changeTime = new Date(history[i].timestamp);
            changeTime.setMinutes(0, 0, 0);
            return changeTime.toISOString();
        }
    }

    // If no changes found in history, return the first entry
    if (history.length > 0) {
        const firstTime = new Date(history[0].timestamp);
        firstTime.setMinutes(0, 0, 0);
        return firstTime.toISOString();
    }

    return null;
}

/**
 * Format date to DD/MM/YY HH[AM/PM] format in host timezone
 * @param {string} isoDate - ISO date string
 * @returns {string} - Formatted date string
 */
function formatDateToLocal(isoDate) {
    if (!isoDate) return null;

    const date = new Date(isoDate);

    // Get date components
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear().toString().slice(-2);

    // Get hour in 12-hour format
    let hours = date.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12

    return `${day}/${month}/${year} ${hours}${ampm}`;
}

/**
 * API endpoint to compare remote and local directory sizes
 */
app.post('/api/compare', async (req, res) => {
    try {
        const { remotePath, localPath, forceDirect } = req.body;

        if (!remotePath || !localPath) {
            return res.status(400).json({
                error: 'Both remotePath and localPath are required'
            });
        }

        // Check if local path exists
        if (!fs.existsSync(localPath)) {
            return res.status(400).json({
                error: `Local path does not exist: ${localPath}`
            });
        }

        // Process local path first, so it gets cached regardless of remote status
        // NEW: Check if local path is in cache, if not add it
        let localSizeData;
        let localSizeBytes;

        if (localCache.data.has(localPath)) {
            localSizeData = localCache.data.get(localPath);
            localSizeBytes = localSizeData.bytes;
            console.log(`[API] Using cached local data for ${localPath} from ${localSizeData.timestamp}`);
        } else {
            console.log(`[API] Local path ${localPath} not in cache, calculating size and adding to cache`);
            try {
                // Calculate size and add to cache
                localSizeData = await addToLocalCache(localPath);
                localSizeBytes = localSizeData.bytes;
            } catch (localError) {
                console.error(`[API] Error calculating local size for ${localPath}:`, localError);
                // Fallback to direct calculation without caching if there's an error
                localSizeBytes = await getDirectorySize(localPath);

                // Still try to initialize size history even on error
                if (!localSizeHistory.data.has(localPath)) {
                    localSizeHistory.data.set(localPath, []);
                }
                localSizeHistory.data.get(localPath).push({
                    timestamp: new Date().toISOString(),
                    bytes: localSizeBytes
                });
            }
        }

        // Get remote size from cache or notify of cache miss
        let remoteSizeData;
        if (remoteCache.data.has(remotePath)) {
            remoteSizeData = remoteCache.data.get(remotePath);
            console.log(`[API] Using cached data for ${remotePath} from ${remoteSizeData.timestamp}`);
        } else {
            console.log(`[API] Cache miss for ${remotePath}, notifying client`);

            // Get last modified time even for cache miss
            const lastModified = getLastModified(localPath);
            const lastModifiedFormatted = formatDateToLocal(lastModified);

            return res.status(404).json({
                status: 'cache-miss',
                message: `Remote path "${remotePath}" not found in cache. Use /api/cache/refresh to update the cache or set forceDirect=true in your request to fetch directly.`,
                remotePath,
                localPath,
                lastModified,
                lastModifiedFormatted, // Add formatted property
                local: {
                    bytes: localSizeBytes,
                    formatted: formatBytes(localSizeBytes),
                    cachedAt: localSizeData ? localSizeData.timestamp : null
                },
                cacheStatus: {
                    lastFullUpdate: remoteCache.lastUpdated,
                    updateInProgress: remoteCache.updateInProgress,
                    updateStartTime: remoteCache.updateStartTime
                }
            });
        }

        // Calculate difference
        const remoteSizeBytes = remoteSizeData.bytes;
        const difference = remoteSizeBytes - localSizeBytes;
        const percentageSynced = remoteSizeBytes > 0
            ? ((localSizeBytes / remoteSizeBytes) * 100).toFixed(2)
            : 0;

        // Get last modified time for the local directory
        const lastModified = getLastModified(localPath);
        const lastModifiedFormatted = formatDateToLocal(lastModified);

// Prepare response
        const response = {
            timestamp: new Date().toISOString(),
            remotePath,
            localPath,
            lastModified,
            lastModifiedFormatted, // Add formatted property
            remote: {
                bytes: remoteSizeBytes,
                formatted: formatBytes(remoteSizeBytes),
                count: remoteSizeData.count,
                cachedAt: remoteSizeData.timestamp
            },
            local: {
                bytes: localSizeBytes,
                formatted: formatBytes(localSizeBytes),
                cachedAt: localSizeData ? localSizeData.timestamp : null
            },
            difference: {
                bytes: difference,
                formatted: formatBytes(Math.abs(difference)),
                direction: difference > 0 ? 'remote-larger' : difference < 0 ? 'local-larger' : 'equal'
            },
            syncStatus: {
                percentageSynced: parseFloat(percentageSynced),
                isSynced: Math.abs(difference) === 0
            },
            cacheStatus: {
                remoteLastUpdate: remoteCache.lastUpdated,
                localLastUpdate: localCache.lastUpdated
            }
        };

        res.json(response);
    } catch (error) {
        console.error(`[API] Error in compare endpoint:`, error);
        res.status(500).json({
            error: error.message
        });
    }
});

/**
 * API endpoint to manually trigger cache update
 */
app.post('/api/cache/refresh', async (req, res) => {
    try {
        console.log(`[CACHE] Manual cache refresh requested at ${new Date().toISOString()}`);

        // Check if a remote update is already in progress
        if (remoteCache.updateInProgress) {
            console.log(`[REMOTE_CACHE] Cache update already in progress, started at ${remoteCache.updateStartTime}`);
        } else {
            // Mark that a remote update is starting
            remoteCache.updateInProgress = true;
            remoteCache.updateStartTime = new Date().toISOString();

            // Start remote cache update in background
            updateRemoteCache()
                .then(() => {
                    console.log(`[REMOTE_CACHE] Manual cache refresh completed successfully`);
                })
                .catch(error => {
                    console.error(`[REMOTE_CACHE] Manual cache refresh failed:`, error);
                });
        }

        // Check if a local update is already in progress
        if (localCache.updateInProgress) {
            console.log(`[LOCAL_CACHE] Cache update already in progress, started at ${localCache.updateStartTime}`);
        } else if (localCache.data.size > 0) {
            // Mark that a local update is starting
            localCache.updateInProgress = true;
            localCache.updateStartTime = new Date().toISOString();

            // Start local cache update in background
            updateLocalCache()
                .then(() => {
                    console.log(`[LOCAL_CACHE] Manual cache refresh completed successfully`);
                })
                .catch(error => {
                    console.error(`[LOCAL_CACHE] Manual cache refresh failed:`, error);
                });
        } else {
            console.log(`[LOCAL_CACHE] No local directories in cache to update`);
        }

        res.json({
            status: 'refresh-started',
            message: 'Cache refresh has been initiated in the background for remote and local caches',
            remote: {
                updateStarted: remoteCache.updateInProgress,
                startedAt: remoteCache.updateStartTime,
                previousUpdate: remoteCache.lastUpdated
            },
            local: {
                updateStarted: localCache.updateInProgress,
                startedAt: localCache.updateStartTime,
                previousUpdate: localCache.lastUpdated,
                directoriesTracked: localCache.data.size
            }
        });
    } catch (error) {
        console.error(`[CACHE] Error in cache refresh endpoint:`, error);
        res.status(500).json({
            error: error.message
        });
    }
});

/**
 * API endpoint to get cache status
 */
app.get('/api/cache/status', (req, res) => {
    const remoteCount = remoteCache.data.size;
    const remoteKeys = Array.from(remoteCache.data.keys());

    const localCount = localCache.data.size;
    const localKeys = Array.from(localCache.data.keys());

    res.json({
        remote: {
            lastUpdated: remoteCache.lastUpdated,
            updateInProgress: remoteCache.updateInProgress,
            updateStartTime: remoteCache.updateStartTime,
            remoteCount,
            remotes: remoteKeys.map(key => ({
                path: key,
                size: formatBytes(remoteCache.data.get(key).bytes),
                bytes: remoteCache.data.get(key).bytes,
                count: remoteCache.data.get(key).count,
                timestamp: remoteCache.data.get(key).timestamp,
                calculationDuration: remoteCache.data.get(key).calculationDurationMs ?
                    `${(remoteCache.data.get(key).calculationDurationMs / 1000).toFixed(2)}s` : undefined
            }))
        },
        local: {
            lastUpdated: localCache.lastUpdated,
            updateInProgress: localCache.updateInProgress,
            updateStartTime: localCache.updateStartTime,
            directoryCount: localCount,
            directories: localKeys.map(key => ({
                path: key,
                size: formatBytes(localCache.data.get(key).bytes),
                bytes: localCache.data.get(key).bytes,
                timestamp: localCache.data.get(key).timestamp,
                calculationDuration: localCache.data.get(key).calculationDurationMs ?
                    `${(localCache.data.get(key).calculationDurationMs / 1000).toFixed(2)}s` : undefined
            }))
        }
    });
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        cacheStatus: {
            remote: {
                lastUpdated: remoteCache.lastUpdated,
                remotesInCache: remoteCache.data.size
            },
            local: {
                lastUpdated: localCache.lastUpdated,
                directoriesInCache: localCache.data.size
            }
        }
    });
});

/**
 * Create a log file for the cache operation
 */
function setupCacheLogging() {
    const logDir = process.env.LOG_DIR || './logs';

    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
        console.log(`[CACHE] Creating log directory at ${logDir}`);
        fs.mkdirSync(logDir, { recursive: true });
    }

    // Create a writable stream for the log file
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const logPath = path.join(logDir, `cache-${today}.log`);

    console.log(`[CACHE] Setting up cache logging to ${logPath}`);

    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    // Backup original console methods
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;

    // Override console methods to also write to the log file
    console.log = function() {
        const args = Array.from(arguments);
        const message = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
        ).join(' ');

        // Only log cache-related messages to the file
        if (message.includes('[CACHE]') ||
            message.includes('[REMOTE_CACHE]') ||
            message.includes('[LOCAL_CACHE]')) {
            logStream.write(`${new Date().toISOString()} - ${message}\n`);
        }

        // Call original console method
        originalConsoleLog.apply(console, args);
    };

    console.error = function() {
        const args = Array.from(arguments);
        const message = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
        ).join(' ');

        // Only log cache-related messages to the file
        if (message.includes('[CACHE]') ||
            message.includes('[REMOTE_CACHE]') ||
            message.includes('[LOCAL_CACHE]')) {
            logStream.write(`${new Date().toISOString()} - ERROR - ${message}\n`);
        }

        // Call original console method
        originalConsoleError.apply(console, args);
    };

    return logStream;
}

/**
 * Start the server and initialize cache
 */
app.listen(port, () => {
    console.log(`Sync comparison service listening on port ${port}`);

    // Setup logging for cache operations
    const logStream = setupCacheLogging();

    // Process any command line arguments
    const args = process.argv.slice(2);
    const skipInitialUpdate = args.includes('--skip-initial-cache');

    // Initialize cache and schedule updates
    scheduleCacheUpdates(!skipInitialUpdate);

    console.log(`[CACHE] Cache system initialized with the following settings:`);
    console.log(`[CACHE] - Skip initial update: ${skipInitialUpdate}`);
    console.log(`[CACHE] - Remote update interval: 24 hours`);
    console.log(`[CACHE] - Local update interval: 1 hour`);
    console.log(`[CACHE] - Logging enabled: true`);
    console.log(`[CACHE] - Local directory caching: enabled`);
    console.log(`[CACHE] - Size history tracking: enabled`);

    // Handle process shutdown
    process.on('SIGINT', () => {
        console.log(`[CACHE] Shutting down, closing log file`);
        logStream.end();
        process.exit();
    });
});