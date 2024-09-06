local icons = require("icons")
local colors = require("colors")
local settings = require("settings")

-- Execute the event provider binary which provides the event "network_update"
-- for the network interface "en0", which is fired every 2.0 seconds.
sbar.exec(
  "killall network_load >/dev/null; $CONFIG_DIR/helpers/event_providers/network_load/bin/network_load en0 network_update 2.0")

-- local popup_width = 250

local wifi_up = sbar.add("item", "widgets.wifi1", {
  position = "right",
  padding_left = -5,
  width = 0,
  icon = {
    padding_right = 0,
    font = {
      style = settings.font.style_map["Bold"],
      size = 9.0,
    },
    string = icons.wifi.upload,
  },
  label = {
    font = {
      family = settings.font.numbers,
      style = settings.font.style_map["Bold"],
      size = 9.0,
    },
    color = colors.red,
    string = "???  Bps",
    align = "right",
    -- width = 80,
  },
  y_offset = 4,
})

local wifi_down = sbar.add("item", "widgets.wifi2", {
  position = "right",
  padding_left = -5,
  icon = {
    padding_right = 0,
    font = {
      style = settings.font.style_map["Bold"],
      size = 9.0,
    },
    string = icons.wifi.download,
  },
  label = {
    font = {
      family = settings.font.numbers,
      style = settings.font.style_map["Bold"],
      size = 9.0,
    },
    color = colors.blue,
    string = "???  Bps",
    align = "right",
    -- width = 80
  },
  y_offset = -4,
})


local wifi = sbar.add("item", "widgets.wifi.padding", {
  position = "right",
  label = { drawing = false },
})

-- Background around the item
local wifi_bracket = sbar.add("bracket", "widgets.wifi.bracket", {
  wifi.name,
  wifi_up.name,
  wifi_down.name
}, {
  -- background = { color = colors.bg1 },
  popup = { align = "center", height = 30 }
})

sbar.add("item", { position = "right", width = settings.group_paddings })

local function network_update(env)
  local up_color = (env.upload == "000") and colors.grey or colors.red
  local down_color = (env.download == "000") and colors.grey or colors.blue

  local ed_up = string.gsub(env.upload, "^000", "___")
  ed_up = string.gsub(ed_up, "^00", "__")
  ed_up = string.gsub(ed_up, "^0", "_")
  local ed_down = string.gsub(env.download, "^000", "___")
  ed_down = string.gsub(ed_down, "^00", "__")
  ed_down = string.gsub(ed_down, "^0", "_")

  wifi_up:set({
    icon = { color = up_color },
    label = {
      string = ed_up .. " " .. env.up_unit,
      color = up_color
    }
  })
  wifi_down:set({
    icon = { color = down_color },
    label = {
      string = ed_down .. " " .. env.down_unit,
      color = down_color
    }
  })
end

local function wifi_change(env)
  sbar.exec("ipconfig getifaddr en0", function(ip)
    local connected = not (ip == "")
    wifi:set({
      icon = {
        string = connected and icons.wifi.connected or icons.wifi.disconnected,
        color = connected and colors.white or colors.red,
      },
    })
  end)
end

wifi_up:subscribe("network_update", network_update)
wifi:subscribe({ "wifi_change", "system_woke" }, wifi_change)
