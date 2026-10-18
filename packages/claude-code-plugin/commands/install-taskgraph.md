Check if TaskGraph is installed and install it if needed.

This command helps you get TaskGraph set up globally on your system.

## Detection and Installation Process

1. **Check Current Installation**
   ```bash
   # Check if taskgraph command exists
   which taskgraph || echo "TaskGraph not found"
   
   # Check npm global packages
   npm list -g taskgraph-ai
   ```

2. **System Requirements Check**
   ```bash
   # Verify Node.js is installed
   node --version
   
   # Verify npm is installed  
   npm --version
   
   # Check Node version (need 16+)
   ```

3. **Install TaskGraph Globally**
   If not installed, run:
   ```bash
   npm install -g taskgraph-ai
   ```

4. **Verify Installation**
   ```bash
   # Check version
   taskgraph --version
   
   # Verify command is available
   which taskgraph
   ```

5. **Initial Setup**
   ```bash
   # Initialize in current directory
   taskgraph init
   ```

6. **Configure AI Provider**
   Ensure you have at least one AI provider API key set:
   ```bash
   # Check current configuration
   taskgraph models --status
   
   # If no API keys found, guide setup
   echo "You'll need at least one API key:"
   echo "- ANTHROPIC_API_KEY for Claude"
   echo "- OPENAI_API_KEY for GPT models"
   echo "- PERPLEXITY_API_KEY for research"
   echo ""
   echo "Set them in your shell profile or .env file"
   ```

7. **Quick Test**
   ```bash
   # Create a test PRD
   echo "Build a simple hello world API" > test-prd.txt
   
   # Try parsing it
   taskgraph parse-prd test-prd.txt -n 3
   ```

## Troubleshooting

If installation fails:

**Permission Errors:**
```bash
# Try with sudo (macOS/Linux)
sudo npm install -g taskgraph-ai

# Or fix npm permissions
npm config set prefix ~/.npm-global
export PATH=~/.npm-global/bin:$PATH
```

**Network Issues:**
```bash
# Use different registry
npm install -g taskgraph-ai --registry https://registry.npmjs.org/
```

**Node Version Issues:**
```bash
# Install Node 20+ via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
```

## Success Confirmation

Once installed, you should see:
```
✅ TaskGraph v0.16.2 (or higher) installed
✅ Command 'taskgraph' available globally
✅ AI provider configured
✅ Ready to use slash commands!

Try: /project:taskgraph:init your-prd.md
```

## Next Steps

After installation:
1. Run `/project:utils:check-health` to verify setup
2. Configure AI providers with `/project:taskgraph:models`
3. Start using TaskGraph commands!