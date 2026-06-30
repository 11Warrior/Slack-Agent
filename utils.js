export const log = {
    info: (message, ...args) => (console.log(`[INFO]  ${message}`, ...args)),
    error: (message, ...args) => (console.log(`[ERR]  ${message}`, ...args)),
    debug: (message, ...args) => (process.env.NODE_ENV === 'development' && console.log(`[DEBUG]  ${message}`, ...args))
}
