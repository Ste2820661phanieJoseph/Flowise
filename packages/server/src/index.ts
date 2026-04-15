import express, { Request, Response } from 'express'
import path from 'path'
import cors from 'cors'
import http from 'http'
import * as fs from 'fs'
import { Server } from 'socket.io'
import logger from './utils/logger'
import { expressRequestLogger } from './utils/logger'

/**
 * Main entry point for the Flowise server.
 * Sets up Express application with middleware, routes, and Socket.IO.
 */

const PORT = parseInt(process.env.PORT || '3000', 10)
const HOST = process.env.HOST || '0.0.0.0'

export const app = express()
export let io: Server

/**
 * Configure Express middleware
 */
const configureMiddleware = () => {
    // Parse JSON request bodies
    app.use(express.json({ limit: '50mb' }))
    app.use(express.urlencoded({ limit: '50mb', extended: true }))

    // Enable CORS for all origins in development
    if (process.env.NODE_ENV !== 'production') {
        app.use(cors())
    } else {
        const corsOptions = {
            origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : '*',
            optionsSuccessStatus: 200
        }
        app.use(cors(corsOptions))
    }

    // Request logging middleware
    app.use(expressRequestLogger)
}

/**
 * Serve static frontend assets if they exist
 */
const configureStaticFiles = () => {
    const uiDistPath = path.join(__dirname, '..', '..', 'ui', 'dist')
    if (fs.existsSync(uiDistPath)) {
        app.use(express.static(uiDistPath))
        app.get('*', (_req: Request, res: Response) => {
            res.sendFile(path.join(uiDistPath, 'index.html'))
        })
        logger.info(`Serving UI from: ${uiDistPath}`)
    } else {
        logger.warn('UI build not found. Run `pnpm build` in the ui package.')
    }
}

/**
 * Health check endpoint
 */
const configureRoutes = () => {
    app.get('/api/v1/ping', (_req: Request, res: Response) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() })
    })
}

/**
 * Initialize and start the HTTP server
 */
const startServer = async () => {
    configureMiddleware()
    configureRoutes()
    configureStaticFiles()

    const server = http.createServer(app)

    // Initialize Socket.IO for real-time communication
    io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    })

    io.on('connection', (socket) => {
        logger.info(`Socket connected: ${socket.id}`)
        socket.on('disconnect', () => {
            logger.info(`Socket disconnected: ${socket.id}`)
        })
    })

    server.listen(PORT, HOST, () => {
        logger.info(`Flowise server running at http://${HOST}:${PORT}`)
    })

    // Graceful shutdown handlers
    process.on('SIGTERM', () => {
        logger.info('SIGTERM received. Shutting down gracefully...')
        server.close(() => {
            logger.info('Server closed.')
            process.exit(0)
        })
    })

    process.on('SIGINT', () => {
        logger.info('SIGINT received. Shutting down gracefully...')
        server.close(() => {
            logger.info('Server closed.')
            process.exit(0)
        })
    })
}

startServer().catch((err) => {
    logger.error('Failed to start server:', err)
    process.exit(1)
})
