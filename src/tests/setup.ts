// Jest setup file for Atlas
import 'dotenv/config'

// Mock environment variables for testing
process.env.NODE_ENV = 'test'
process.env.PORT = '3003'
process.env.DIGITALOCEAN_API_TOKEN = 'test-do-token'
process.env.LOG_LEVEL = 'warn'

// Increase timeout for integration tests
jest.setTimeout(30000)