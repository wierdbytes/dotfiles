local icons = require("icons")
local colors = require("colors")

local whitelist = { ["Spotify"] = true,
                    ["Music"] = true,
                    ["Brave Browser"] = true,    };

local playing = false

local media_cover = sbar.add("item", {
  position = "right",
  background = {
    image = {
      string = "media.artwork",
      scale = 0.70,
    },
    color = colors.transparent,
  },
  label = { drawing = false },
  icon = { drawing = false },
  drawing = false,
  updates = true,
  popup = {
    align = "center",
    horizontal = true,
  }
})

local media_artist = sbar.add("item", {
  position = "right",
  drawing = false,
  padding_left = 3,
  padding_right = 0,
  width = 0,
  icon = { drawing = false },
  label = {
    width = 0,
    font = { size = 9 },
    color = colors.with_alpha(colors.white, 0.6),
    max_chars = 24,
    y_offset = 6,
  },
})

local media_title = sbar.add("item", {
  position = "right",
  drawing = false,
  padding_left = 3,
  padding_right = 0,
  icon = { drawing = false },
  label = {
    font = { size = 11 },
    width = 0,
    max_chars = 20,
    y_offset = -5,
  },
})

sbar.add("item", {
  position = "popup." .. media_cover.name,
  icon = { string = icons.media.back },
  label = { drawing = false },
  click_script = "nowplaying-cli previous",
})
sbar.add("item", {
  position = "popup." .. media_cover.name,
  icon = { string = icons.media.play_pause },
  label = { drawing = false },
  click_script = "nowplaying-cli togglePlayPause",
})
sbar.add("item", {
  position = "popup." .. media_cover.name,
  icon = { string = icons.media.forward },
  label = { drawing = false },
  click_script = "nowplaying-cli next",
})

local function animate_detail(show)
  sbar.animate("tanh", 30, function()
    media_artist:set({ label = { width = show and "dynamic" or 0 } })
    media_title:set({ label = { width = show and "dynamic" or 0 } })
  end)
end

media_cover:subscribe("media_change", function(env)
  if whitelist[env.INFO.app] then
    local drawing = (env.INFO.state == "playing" or env.INFO.state == "paused")
    playing = (env.INFO.state == "playing")

    local changed = not (env.INFO.artist == media_artist:query().label and env.INFO.title == media_title:query().label)

    media_cover:set({ drawing = drawing })

    if playing then
      if changed then
        animate_detail(false)
        sbar.delay(0.5, function()
          media_artist:set({ drawing = drawing, label = env.INFO.artist, })
          media_title:set({ drawing = drawing, label = env.INFO.title, })
          animate_detail(true)
        end)
      else
        animate_detail(true)
      end
    else
      media_cover:set({ popup = { drawing = false } })
      animate_detail(false)
    end
  end
end)

media_cover:subscribe("mouse.entered", function(env)
  animate_detail(true)
end)

media_cover:subscribe("mouse.exited", function(env)
  if not playing then
    animate_detail(false)
  end
end)

media_cover:subscribe("mouse.clicked", function(env)
  media_cover:set({ popup = { drawing = "toggle" }})
end)

media_title:subscribe("mouse.exited.global", function(env)
  media_cover:set({ popup = { drawing = false }})
end)
