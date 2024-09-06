local icons = require("icons")
local colors = require("colors")
local settings = require("settings")

local keyboard = sbar.add("item", "widgets.keyboard", {
  position = "right",
  padding_right = 0,
  padding_left = 0,
  icon = {
    font = {
      size = 13.0,
      family = settings.font.numbers,
    },
    string = "??",
    padding_right = 8,
    padding_left = 8,
    width = 32,
  },
  label = {
    padding_left = 0,
    padding_right = 0,
  },
})

local function get_keyboard_layout()
  sbar.exec("defaults read ~/Library/Preferences/com.apple.HIToolbox.plist AppleCurrentKeyboardLayoutInputSourceID",
    function(result)
      local icon = "??"
      if result == "com.apple.keylayout.US\n" then
        -- icon = "🇺🇸"
        icon = "EN"
      elseif result == "com.apple.keylayout.Russian\n" then
        -- icon = "🇷🇺"
        icon = "RU"
      end
      keyboard:set({
        icon = { string = icon },
      })
    end)
end

get_keyboard_layout()

keyboard:subscribe({ "kb-layout-change" }, function(env)
  get_keyboard_layout()
  sbar.delay(1,
    function()             -- когда переключение языка происходит без фокуса в поле ввода - он фактически переключается не сразу
      get_keyboard_layout()
    end)
end)

-- sbar.add("bracket", "widgets.keyboard.bracket", { keyboard.name }, {
--   background = { color = colors.bg1 }
-- })

-- sbar.add("item", "widgets.keyboard.padding", {
--   position = "right",
--   width = settings.group_paddings
-- })
