#!/bin/bash
# Install script for siyuan-plugin-clouddrive
# This script copies the plugin to the SiYuan plugins directory

PLUGIN_DIR="$HOME/.siyuan/data/plugins/siyuan-plugin-clouddrive"

echo "Installing siyuan-plugin-clouddrive..."

# Create plugin directory if not exists
mkdir -p "$PLUGIN_DIR"

# Copy all plugin files
cp -r . "$PLUGIN_DIR/"

echo "Plugin installed to: $PLUGIN_DIR"
echo "Please restart SiYuan and enable the plugin in Settings > Marketplace > Downloaded"
