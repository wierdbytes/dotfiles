local colors = require("colors")
local settings = require("settings")

-- Equivalent to the --bar domain
sbar.bar({
  topmost = "window",
  height = settings.bar.height,
  color = colors.bar.bg,
  padding_right = 2,
  padding_left = 2,
  display = "all",
})

sbar.add("event", "toggle_zen_mode")
