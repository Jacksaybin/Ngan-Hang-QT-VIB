module.exports = {
    apps: [
        {
            name: 'vib-server',
            script: 'server.js',
            cwd: __dirname,
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '200M',
            env: {
                NODE_ENV: 'development',
                PORT: 4000,
                HOST: '127.0.0.1'
            },
            env_production: {
                NODE_ENV: 'production',
                PORT: 4000,
                // When deploying to a public VPS you typically want HOST=0.0.0.0
                HOST: process.env.HOST || '0.0.0.0'
            }
        }
    ]
};
