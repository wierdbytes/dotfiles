local colors = require("colors")
local settings = require("settings")

local front_app = sbar.add("item", "front_app", {
  position = "center",
  display = "active",
  icon = {
    background = {
      drawing = true,
      image = {
        scale = 0.8,
        border_width = 0,
        border_color = colors.transparent,
      }
    },
  },
  label = {
    font = {
      style = settings.font.style_map["Black"],
      size = 12.0,
    },
  },
  updates = true,
})

local function end_animation(env)
  sbar.animate("tanh", 5, function()
    front_app:set({
      y_offset = 0,
      label = {
        color = colors.with_alpha(colors.white, 1.0),
      },
    })
  end)
end

local function start_animation(env)
  sbar.animate("tanh", 5, function()
    front_app:set({
      y_offset = 24,
      label = {
        color = colors.with_alpha(colors.white, 0.0),
      },
    })
  end)

  sbar.exec("sleep 0.05 && echo 'end_bounce_animation'", function()
    front_app:set({
      icon = { background = { image = "app." .. env.INFO } },
      label = { string = env.INFO }
    })
    front_app:set({
      y_offset = -24,
    })
    end_animation()
  end)
end

front_app:subscribe("front_app_switched", function(env)
  start_animation(env)
end)
