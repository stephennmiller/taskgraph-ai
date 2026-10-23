---
description: "TaskGraph: check the taskgraph CLI is installed, and install it if not."
argument-hint: "[--quick]"
---

Check if TaskGraph is installed and install it if needed.

Usage: `/taskgraph:install-taskgraph [--quick]`

Arguments: $ARGUMENTS

With `--quick`, skip the walkthrough below and only run:

```bash
# Check and install in one command
taskgraph --version 2>/dev/null || npm install -g taskgraph-ai

# Verify installation
taskgraph --version

# Quick setup check
taskgraph models || echo "Note: TaskGraph uses Claude Code; make sure it is installed and signed in"
```

If you see "command not found" after installation, restart your terminal or add the npm global bin to PATH: `export PATH=$(npm bin -g):$PATH`.

Without `--quick`, this command helps you get TaskGraph set up globally on your system.

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

6. **Check the AI provider**
   TaskGraph uses Claude Code, so no API keys are needed. Make sure Claude Code is installed and signed in:
   ```bash
   # Verify Claude Code is available
   claude --version

   # Check current model configuration
   taskgraph models
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
✅ TaskGraph installed
✅ Command 'taskgraph' available globally
✅ AI provider configured
✅ Ready to use slash commands!

Try: /taskgraph:init-project your-prd.md
```

## Next Steps

After installation:
1. Run `taskgraph models` to verify setup
2. Configure models with `/taskgraph:setup-models`
3. Start using TaskGraph commands!