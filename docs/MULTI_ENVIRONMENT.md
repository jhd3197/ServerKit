# Multi-Environment WordPress Setup Guide

ServerKit v1.1 introduces multi-environment support, allowing you to link production and development WordPress instances that share the same database with separate table prefixes.

## Overview

### What is Multi-Environment Linking?

Multi-environment linking allows you to:
- Create **production** and **development** versions of the same WordPress site
- Share the same database between environments (with different table prefixes)
- Quickly navigate between linked environments in the UI
- Maintain separate content, themes, and plugins for each environment

### Use Case: WordPress Theme Development

A common workflow:
1. **Production** WordPress serves live traffic with the stable theme
2. **Development** WordPress uses the same database for content reference
3. Develop and test new theme in dev without affecting production
4. When ready, deploy theme changes to production

## Quick Start

### Step 1: Deploy Production WordPress

1. Go to **Applications** > **New Application**
2. Select the **WordPress** template
3. Configure your production instance:
   - **Name**: `my-site-prod` (or your preferred name)
   - **Port**: Choose an available port
4. Click **Install** and wait for deployment

### Step 2: Deploy Development WordPress

1. Go to **Applications** > **New Application**
2. Select **WordPress (External Database)** template
3. Configure your development instance:
   - **Name**: `my-site-dev`
   - **Port**: Different from production

4. Enter the same database credentials as production:
   - **DB Host**: Same as production
   - **DB Port**: Usually `3306`
   - **DB Name**: Same database name
   - **DB User**: Same database user
   - **DB Password**: Same password
   - **Table Prefix**: `wp_dev_` (MUST be different from production)

5. Click **Test Connection** to verify database access
6. Click **Install**

### Step 3: Link the Applications

1. Navigate to your **production** app's detail page
2. Find the **Environment Linking** section in the Overview tab
3. Click **Link App**
4. In the modal:
   - Select your development app from the dropdown
   - Choose **Development** as the environment type
   - Keep "Propagate database credentials" enabled
5. Click **Link Apps**

### Step 4: Verify the Setup

After linking, you should see:
- **PROD** badge on your production app
- **DEV** badge on your development app
- Quick navigation buttons between linked apps
- Shared Database information displayed

## Understanding Environment Types

| Type | Badge | Description |
|------|-------|-------------|
| Production | Green PROD | Live/stable environment |
| Development | Blue DEV | Testing/development environment |
| Staging | Yellow STAGING | Pre-production testing |
| Standalone | None | Not linked to any environment |

## Managing Linked Apps

### Navigating Between Environments

In the **Linked Apps** section of any linked app:
- Click the **arrow icon** to navigate to the linked app
- Both apps are always one click away from each other

### Unlinking Apps

To unlink apps:
1. Go to either app's **Settings** tab
2. Find the **Environment Configuration** section
3. Click **Unlink Application**
4. Confirm the action

Both apps will become "Standalone" and continue to function independently.

### Changing Environment Type

For standalone (unlinked) apps:
1. Go to the app's **Settings** tab
2. Use the **Environment Type** dropdown
3. Select the desired type
4. Change is saved automatically

Note: Linked apps cannot change their environment type without unlinking first.

## Filtering Apps by Environment

In the Applications list:
1. Find the **Environment** filter dropdown in the toolbar
2. Select an environment type to filter:
   - **All Environments** - Show everything
   - **Production** - Only production apps
   - **Development** - Only development apps
   - **Staging** - Only staging apps
   - **Standalone** - Only unlinked apps

The filter persists in the URL for bookmarking.

## Database Sharing Details

### How Table Prefixes Work

When you install WordPress with an external database:
- Production uses: `wp_posts`, `wp_options`, etc.
- Development uses: `wp_dev_posts`, `wp_dev_options`, etc.

Both installations:
- Share the same MySQL database
- Have completely separate WordPress data
- Can have different themes, plugins, and settings

### Credential Propagation

When linking apps with "Propagate database credentials" enabled:
- Database host, name, user, and password are synchronized
- Table prefix remains unique to each environment
- Changes to credentials are not automatically synced (manual update needed)

## Best Practices

### Naming Conventions
- Use consistent naming: `mysite-prod`, `mysite-dev`, `mysite-staging`
- Include environment in the name for clarity

### Table Prefixes
- Production: `wp_` (default)
- Development: `wp_dev_`
- Staging: `wp_staging_`

### Backup Strategy
- Back up your database before major changes
- Each environment shares the database but has separate tables
- A database backup protects all environments

### Theme Development Workflow
1. Install and customize themes in **development**
2. Test thoroughly with dev content
3. When ready, manually copy theme files to production
4. Or use your deployment tool to sync themes

## Limitations

### Not Yet Implemented
- **Theme Sync**: Automatic copying of themes between environments is planned for a future release
- **Plugin Sync**: Plugins must be installed separately in each environment
- **Content Sync**: Content is separate by design (different table prefixes)

### Requirements
- Both apps must be the **same type** (WordPress to WordPress)
- Neither app can be already linked to another
- Database must be accessible from both app containers
- You must specify a unique table prefix for each environment

## Troubleshooting

### "No Compatible Apps" in Link Modal
- Ensure you have another WordPress app that is:
  - Not already linked
  - Set as "Standalone" environment
  - Running (or at least created)

### Database Connection Failed
- Verify MySQL is running and accessible
- Check firewall rules allow connections
- Confirm credentials are correct
- Try the **Test Connection** button before installing

### Apps Show Wrong Environment
- Unlink the apps
- Re-link with correct environment assignments
- Only standalone apps can be linked

### Can't Change Environment Type
- If the app is linked, you must unlink it first
- Only standalone apps can change their environment type

## API Reference

For programmatic access, see the [API Documentation](./API.md).

Key endpoints:
- `POST /apps/{id}/link` - Link two apps
- `GET /apps/{id}/linked` - Get linked apps
- `DELETE /apps/{id}/link` - Unlink apps
- `PUT /apps/{id}/environment` - Change environment type
- `GET /apps?environment=production` - Filter by environment
