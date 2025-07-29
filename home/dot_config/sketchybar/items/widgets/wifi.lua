local icons = require("icons")
local colors = require("colors")
local settings = require("settings")

sbar.exec(
  "pkill -f 'netstat -w1' ; netstat -w1 | awk '/[0-9]/ {print $3 \",\" $6; fflush(stdout)}' | xargs -I {} bash -c \"sketchybar --trigger netstat_update DOWNLOAD=\\$(cut -d, -f1 <<< {}) UPLOAD=\\$(cut -d, -f2 <<< {})\""
)

local function formatBytes(bytes)
  if bytes == 0 then
    return "0b"
  end

  local k = 1024
  local dm = 1
  local sizes = { "Bs", "kB", "mB", "gB", "tB", "pB", "eB", "zB", "yB" }

  local i = math.floor(math.log(bytes) / math.log(k))

  local value = bytes / (k ^ i)
  if value >= 100 then
    dm = 0
  end
  local formattedValue = string.format("%." .. dm .. "f", value)

  return formattedValue .. " " .. sizes[i + 1]
end

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
    string = "??? B",
    align = "right",
    width = 50,
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
    string = "??? B",
    align = "right",
    width = 50
  },
  y_offset = -4,
})


local wifi = sbar.add("item", "widgets.wifi.padding", {
  position = "right",
  label = { drawing = false },
})

-- sbar.add("item", { position = "right", width = settings.group_paddings })

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

wifi_up:subscribe("netstat_update", function(env)
  local download = formatBytes(env.DOWNLOAD)
  local upload = formatBytes(env.UPLOAD)
  wifi_up:set({
    label = {
      string = upload,
      color = colors.red,
    },
    icon = {
      color = colors.red
    },
  })
  wifi_down:set({
    label = {
      string = download,
      color = colors.blue,
    },
    icon = {
      color = colors.blue
    },
  })
end)

wifi:subscribe({ "wifi_change", "system_woke" }, wifi_change)

local zen = require("zen")
zen.handler(wifi)
zen.handler(wifi_up)
zen.handler(wifi_down)
