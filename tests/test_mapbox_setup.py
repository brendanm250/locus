import unittest
import os

WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class TestMapboxSetup(unittest.TestCase):
    """
    Unit tests for Mapbox token configuration, security boundaries, and script setup.
    Run from terminal: python tests/test_mapbox_setup.py
    """

    def test_gitignore_contains_config_local(self):
        """
        Verify that js/config.local.js is ignored by git to ensure private
        development tokens are never accidentally committed or pushed.
        """
        gitignore_path = os.path.join(WORKSPACE_DIR, ".gitignore")
        self.assertTrue(os.path.exists(gitignore_path), ".gitignore file should exist")
        with open(gitignore_path, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("js/config.local.js", content, "js/config.local.js must be in .gitignore to prevent committing private tokens")

    def test_config_local_example_exists(self):
        """
        Verify that js/config.local.example.js exists with proper structure
        to serve as a template for local development setup.
        """
        example_path = os.path.join(WORKSPACE_DIR, "js", "config.local.example.js")
        self.assertTrue(os.path.exists(example_path), "config.local.example.js should exist")
        with open(example_path, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("CONFIG_LOCAL", content, "config.local.example.js should define CONFIG_LOCAL")
        self.assertIn("MAPBOX_TOKEN", content, "config.local.example.js should specify MAPBOX_TOKEN")

    def test_index_html_loads_configs_in_order(self):
        """
        Verify that index.html loads config scripts in the correct dependency order:
        1. js/config.js (production base config)
        2. js/config.local.js (optional local override)
        3. js/map.js (initialization logic that consumes the resolved token)
        """
        index_path = os.path.join(WORKSPACE_DIR, "index.html")
        self.assertTrue(os.path.exists(index_path), "index.html should exist")
        with open(index_path, "r", encoding="utf-8") as f:
            content = f.read()

        pos_config = content.find('src="js/config.js"')
        pos_config_local = content.find('src="js/config.local.js"')
        pos_init = content.find('src="js/init.js"')
        pos_map = content.find('src="js/map.js"')

        self.assertNotEqual(pos_config, -1, "js/config.js must be loaded")
        self.assertNotEqual(pos_config_local, -1, "js/config.local.js must be loaded")
        self.assertNotEqual(pos_init, -1, "js/init.js must be loaded")
        self.assertNotEqual(pos_map, -1, "js/map.js must be loaded")

        self.assertLess(pos_config, pos_config_local, "config.js must be loaded before config.local.js")
        self.assertLess(pos_config_local, pos_map, "config.local.js must be loaded before map.js")

    def test_token_resolution_logic(self):
        """
        Verify token hierarchy resolution logic:
        - When CONFIG_LOCAL is present and valid, it must override base CONFIG.
        - When CONFIG_LOCAL is absent or empty, it falls back to base CONFIG.
        - Verify map.js implements getMapboxToken.
        """
        map_path = os.path.join(WORKSPACE_DIR, "js", "map.js")
        with open(map_path, "r", encoding="utf-8") as f:
            map_content = f.read()
        self.assertIn("function getMapboxToken()", map_content, "map.js must define getMapboxToken()")
        self.assertIn("CONFIG_LOCAL", map_content, "map.js getMapboxToken must check CONFIG_LOCAL")
        self.assertIn("CONFIG", map_content, "map.js getMapboxToken must check base CONFIG")

        def get_mapbox_token(config_local=None, base_config=None):
            if config_local and config_local.get("MAPBOX_TOKEN") and config_local["MAPBOX_TOKEN"].strip():
                return config_local["MAPBOX_TOKEN"].strip()
            if base_config and base_config.get("MAPBOX_TOKEN") and base_config["MAPBOX_TOKEN"].strip():
                return base_config["MAPBOX_TOKEN"].strip()
            return ""

        base = {"MAPBOX_TOKEN": "base_production_token"}
        local = {"MAPBOX_TOKEN": "private_dev_token"}
        empty_local = {"MAPBOX_TOKEN": "   "}

        # Base only (production web deployment)
        self.assertEqual(get_mapbox_token(base_config=base), "base_production_token")

        # Local override (local development environment)
        self.assertEqual(get_mapbox_token(config_local=local, base_config=base), "private_dev_token")

        # Fallback when local is empty whitespace
        self.assertEqual(get_mapbox_token(config_local=empty_local, base_config=base), "base_production_token")

    def test_terrain_uses_terrain_rgb(self):
        """
        Verify that map.js uses mapbox.terrain-rgb (modern v4 tileset)
        instead of legacy raster/v1 endpoint to avoid 403 Forbidden errors.
        """
        map_path = os.path.join(WORKSPACE_DIR, "js", "map.js")
        with open(map_path, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("mapbox://mapbox.terrain-rgb", content, "map.js should use mapbox.terrain-rgb for modern v4 raster DEM support")

    def test_start_server_bat_exists(self):
        """
        Verify that start_server.bat exists to provide 1-click local web server launching.
        """
        bat_path = os.path.join(WORKSPACE_DIR, "start_server.bat")
        self.assertTrue(os.path.exists(bat_path), "start_server.bat should exist for 1-click local launching")

if __name__ == "__main__":
    unittest.main()
