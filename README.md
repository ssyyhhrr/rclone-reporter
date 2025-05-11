<a name="readme-top"></a>
[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![LinkedIn][linkedin-shield]][linkedin-url]

<h3 align="center">rclone-reporter</h3>

  <p align="center">
    A lightweight Express.js API for comparing file sizes between rclone remotes and local directories, initially designed for use with <a href="https://github.com/glanceapp/glance">Glance</a>.
    <br />
    <br />
    <a href="https://github.com/ssyyhhrr/rclone-reporter/issues">Report Bug</a>
    ·
    <a href="https://github.com/ssyyhhrr/rclone-reporter/issues">Request Feature</a>
  </p>
</div>



<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
    </li>
    <li><a href="#prerequisites">Prerequisites</a></li>
    <li><a href="#installation">Installation</a></li>
    <li><a href="#environment-configuration">Environment Configuration</a></li>
    <li><a href="#api-endpoints">API Endpoints</a></li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#deployment-considerations">Deployment Considerations</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#troubleshooting">Troubleshooting</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>



<!-- ABOUT THE PROJECT -->
## About The Project

<ul>
    <li>Compare sizes between rclone remotes and local directories</li>
    <li>Intelligent caching system to minimise repeated rclone operations</li>
    <li>Track size history for detecting when directories were last modified</li>
    <li>Automatic cache updates on configurable schedules</li>
    <li>Support for multiple remotes and directories</li>
    <li>Detailed logging system for monitoring operations</li>
    <li>RESTful API endpoints with comprehensive error handling</li>
</ul>

## Prerequisites
<ul>
    <li>Node.js (v14 or higher)</li>
    <li>npm or yarn</li>
    <li>rclone installed and configured with remotes</li>
    <li>Access to local directories for comparison</li>
</ul>

## Installation
1. Clone this repository:
```
git clone https://github.com/ssyyhhrr/rclone-reporter.git
cd rclone-reporter
```

2. Install dependencies:
```
npm install
```

3. Create a `.env` file (see below)

4. Start the server:
```
npm start
```

## Environment Configuration
Create a `.env` file in the root directory with the following variables:
```
PORT=3000
LOG_DIR=./logs
```

## API Endpoints

### Health Check
```
GET /health
```
Returns the service status and cache information.

Example Response:
```json
{
  "status": "ok",
  "timestamp": "2024-03-10T12:00:00.000Z",
  "cacheStatus": {
    "remote": {
      "lastUpdated": "2024-03-10T11:00:00.000Z",
      "remotesInCache": 3
    },
    "local": {
      "lastUpdated": "2024-03-10T11:30:00.000Z",
      "directoriesInCache": 5
    }
  }
}
```

### Compare Remote and Local Directory
```
POST /api/compare
```

Body:
```json
{
  "remotePath": "myremote:path/to/directory",
  "localPath": "/local/path/to/directory",
  "forceDirect": false
}
```

Example Response (Cache Hit):
```json
{
  "timestamp": "2024-03-10T12:00:00.000Z",
  "remotePath": "myremote:path/to/directory",
  "localPath": "/local/path/to/directory",
  "lastModified": "2024-03-09T15:00:00.000Z",
  "lastModifiedFormatted": "09/03/24 3PM",
  "remote": {
    "bytes": 5368709120,
    "formatted": "5 GB",
    "count": 150,
    "cachedAt": "2024-03-10T11:00:00.000Z"
  },
  "local": {
    "bytes": 5368709120,
    "formatted": "5 GB",
    "cachedAt": "2024-03-10T11:30:00.000Z"
  },
  "difference": {
    "bytes": 0,
    "formatted": "0 Bytes",
    "direction": "equal"
  },
  "syncStatus": {
    "percentageSynced": 100,
    "isSynced": true
  }
}
```

Example Response (Cache Miss):
```json
{
  "status": "cache-miss",
  "message": "Remote path \"myremote:path\" not found in cache. Use /api/cache/refresh to update the cache or set forceDirect=true in your request to fetch directly.",
  "remotePath": "myremote:path",
  "localPath": "/local/path",
  "lastModified": "2024-03-09T15:00:00.000Z",
  "lastModifiedFormatted": "09/03/24 3PM",
  "local": {
    "bytes": 1073741824,
    "formatted": "1 GB",
    "cachedAt": "2024-03-10T11:30:00.000Z"
  },
  "cacheStatus": {
    "lastFullUpdate": "2024-03-10T11:00:00.000Z",
    "updateInProgress": false,
    "updateStartTime": null
  }
}
```

### Manual Cache Refresh
```
POST /api/cache/refresh
```

Triggers a manual cache update for all remotes and tracked local directories.

Example Response:
```json
{
  "status": "refresh-started",
  "message": "Cache refresh has been initiated in the background for remote and local caches",
  "remote": {
    "updateStarted": true,
    "startedAt": "2024-03-10T12:15:00.000Z",
    "previousUpdate": "2024-03-10T00:00:00.000Z"
  },
  "local": {
    "updateStarted": true,
    "startedAt": "2024-03-10T12:15:00.000Z",
    "previousUpdate": "2024-03-10T11:00:00.000Z",
    "directoriesTracked": 5
  }
}
```

### Cache Status

```
GET /api/cache/status
```

Returns detailed information about the current cache state.

Example Response:
```json
{
  "remote": {
    "lastUpdated": "2024-03-10T11:00:00.000Z",
    "updateInProgress": false,
    "updateStartTime": null,
    "remoteCount": 3,
    "remotes": [
      {
        "path": "myremote:",
        "size": "1.5 TB",
        "bytes": 1649267441664,
        "count": 50000,
        "timestamp": "2024-03-10T11:00:00.000Z",
        "calculationDuration": "45.2s"
      }
    ]
  },
  "local": {
    "lastUpdated": "2024-03-10T11:30:00.000Z",
    "updateInProgress": false,
    "updateStartTime": null,
    "directoryCount": 5,
    "directories": [
      {
        "path": "/mnt/data",
        "size": "500 GB",
        "bytes": 536870912000,
        "timestamp": "2024-03-10T11:30:00.000Z",
        "calculationDuration": "12.3s"
      }
    ]
  }
}
```

<!-- USAGE EXAMPLES -->
## Usage

### Using cURL
```bash
# Compare remote and local directory
curl -X POST http://localhost:3000/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "remotePath": "myremote:backup/photos",
    "localPath": "/home/user/photos"
  }'

# Refresh cache
curl -X POST http://localhost:3000/api/cache/refresh

# Check cache status
curl http://localhost:3000/api/cache/status
```

### Using JavaScript/Fetch
```js
// Compare directories
fetch('http://localhost:3000/api/compare', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        remotePath: 'myremote:backup/photos',
        localPath: '/home/user/photos'
    }),
})
    .then(response => response.json())
    .then(data => console.log(data));

// Check cache status
fetch('http://localhost:3000/api/cache/status')
    .then(response => response.json())
    .then(data => console.log(data));
```

## Deployment Considerations
1. Ensure rclone is properly configured with all required remotes
2. Ensure adequate permissions for accessing local directories
3. Implement rate limiting if exposing the API publicly
4. Consider adding authentication if the API will be accessed by multiple clients

## Contributing
If you have a suggestion that would make this project better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement". Don't forget to give the project a star! Thanks again!
1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

<!-- LICENSE -->
## License

Distributed under the MIT License. See `LICENSE.txt` for more information.

## Troubleshooting

### Common Issues
1. **"Remote not found in cache":** Run `/api/cache/refresh` to update the cache, or wait for the next scheduled update.
2. **Permission denied errors:** Ensure the service has read access to all local directories being compared.
3. **rclone command not found:** Make sure rclone is installed and available in the system PATH.
4. **High memory usage:** The service caches all remote and local directory information. Reduce the number of tracked directories if memory is limited.
5. **Slow cache updates:** Large remotes can take significant time to calculate. Consider increasing the update interval or using fewer remotes.

<!-- CONTACT -->
## Contact

Rhys Bishop - [https://sy.hr/](https://sy.hr/) - mail@rhysbi.shop

Project Link: [https://github.com/ssyyhhrr/rclone-reporter](https://github.com/ssyyhhrr/ga4-reporter)

<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->
[contributors-shield]: https://img.shields.io/github/contributors/ssyyhhrr/rclone-reporter.svg?style=for-the-badge
[contributors-url]: https://github.com/ssyyhhrr/rclone-reporter/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/ssyyhhrr/rclone-reporter.svg?style=for-the-badge
[forks-url]: https://github.com/ssyyhhrr/rclone-reporter/network/members
[stars-shield]: https://img.shields.io/github/stars/ssyyhhrr/rclone-reporter.svg?style=for-the-badge
[stars-url]: https://github.com/ssyyhhrr/rclone-reporter/stargazers
[issues-shield]: https://img.shields.io/github/issues/ssyyhhrr/rclone-reporter.svg?style=for-the-badge
[issues-url]: https://github.com/ssyyhhrr/rclone-reporter/issues
[license-shield]: https://img.shields.io/github/license/ssyyhhrr/rclone-reporter.svg?style=for-the-badge
[license-url]: https://github.com/ssyyhhrr/rclone-reporter/blob/master/LICENSE.txt
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=for-the-badge&logo=linkedin&colorB=555
[linkedin-url]: https://www.linkedin.com/in/rhys-bishop-158638214/
