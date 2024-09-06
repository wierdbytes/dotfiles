local colors = require("colors")
local icons = require("icons")
local settings = require("settings")

local therm = sbar.add("item", "widgets.temperature", {
  position = "right",
  icon = {
    font = {
      style = settings.font.style_map["Regular"],
      size = 16.0,
    }
  },
  label = {
    string = "??°C",
    font = { family = settings.font.numbers },
  },
  update_freq = 10,
})

local function update()
  sbar.exec(
    "$CONFIG_DIR/helpers/event_providers/macos-temp-tool/macos-temp-tool -f 'SOC' -a | awk '{print $NF}' | cut -d. -f1",
    function(result)
      therm:set({ label = result .. "°C" })
    end)
  sbar.exec("$CONFIG_DIR/helpers/event_providers/macos-temp-tool/macos-temp-tool -p | awk '{print $NF}' | tr -d '\n'",
    function(result)
      print(result)
      local icon = icons.therm.none
      local color = colors.grey
      if result == "Nominal" then
        icon = icons.therm.low
        color = colors.green
      elseif result == "Fair" then
        icon = icons.therm.mid
        color = colors.yellow
      elseif result == "Serious" then
        icon = icons.therm.high
        color = colors.red
      elseif result == "Critical" then
        icon = icons.therm.crit
        color = colors.red
      end
      therm:set({
        icon = {
          string = icon,
          color = color
        },
      })
    end)
end

update()

therm:subscribe("routine", update)

-- sbar.add("bracket", "widgets.temperature.bracket", { therm.name }, {
--   background = { color = colors.bg1 }
-- })

-- sbar.add("item", "widgets.temperature.padding", {
--   position = "right",
--   width = settings.group_paddings
-- })
