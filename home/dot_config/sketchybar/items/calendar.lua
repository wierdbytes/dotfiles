local settings = require("settings")
local colors = require("colors")

-- Padding item required because of bracket
sbar.add("item", { position = "right", width = settings.group_paddings })

local cal = sbar.add("item", {
  icon = {
    color = colors.white,
    padding_left = 8,
    padding_right = 0,
    font = {
      family = settings.font.numbers,
      -- style = settings.font.style_map["Bold"],
      size = settings.font_size_label,
    },
  },
  label = {
    color = colors.white,
    padding_left = 8,
    width = 82,
    align = "left",
    font = {
      family = settings.font.numbers,
      size = settings.font_size_label,
    },
  },
  position = "right",
  update_freq = 1,
  padding_left = 1,
  padding_right = 1,
})

-- Double border for calendar using a single item bracket
sbar.add("bracket", { cal.name }, {
  background = {
    color = colors.bg1,
    border_color = colors.bg2,
  }
})

-- Padding item required because of bracket
sbar.add("item", { position = "right", width = settings.group_paddings })

cal:subscribe({ "forced", "routine", "system_woke" }, function(env)
  cal:set({ icon = os.date("[%d.%m]"), label = os.date("%H:%M:%S") })
end)

cal:subscribe("mouse.clicked", function(env)
  sbar.exec("open -a 'Calendar'")
end)
