for (const key of ['GEMINI_API_KEY', 'MISTRAL_API_KEY', 'GROQ_API_KEY', 'DISCORD_TOKEN']) delete process.env[key];
process.env.DB_PATH = ':memory:';
