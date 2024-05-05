local colors = require("colors")
local icons = require("icons")
local settings = require("settings")

-- Padding item required because of bracket
sbar.add("item", { width = settings.group_paddings })

local apple = sbar.add("item", {
  icon = {
    font = { size = 13.0 },
    string = icons.apple,
    padding_right = 8,
    padding_left = 8,
    -- y_offset = 3,
  },
  label = { drawing = false },
  background = {
    color = colors.bg2,
    border_color = colors.black,
    border_width = 1,
    height = 20,
    -- y_offset = 2,
  },
  padding_left = 1,
  padding_right = 1,
  click_script = "$CONFIG_DIR/helpers/menus/bin/menus -s 0",
})

-- Double border for apple using a single item bracket
sbar.add("bracket", { apple.name }, {
  background = {
    color = colors.transparent,
    height = 22,
    border_color = colors.grey,
  },
  -- y_offset = 2,
})

-- Padding item required because of bracket
sbar.add("item", { width = settings.group_paddings })
