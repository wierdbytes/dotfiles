local settings = require("settings")
local colors = require("colors")
local app_icons = require("helpers.app_icons")

local notify_tg = sbar.add("item", "widgets.notify.tg", {
  width = 0,
  y_offset = -5,
  icon = {
    drawing = true,
    padding_left = 0,
    padding_right = 0,
    string = app_icons["Telegram"],
    color = colors.orange,
    font = "sketchybar-app-font:Regular:8.0"
  },
  label = {
    drawing = false,
  },
  position = "right",
  update_freq = 2,
  padding_left = 0,
  padding_right = 2,
})

local notify_mail = sbar.add("item", "widgets.notify.mail", {
  width = 0,
  y_offset = 5,
  icon = {
    drawing = true,
    padding_left = 0,
    padding_right = 0,
    string = app_icons["Mail"],
    color = colors.orange,
    font = "sketchybar-app-font:Regular:8.0"
  },
  label = {
    drawing = false,
  },
  position = "right",
  update_freq = 2,
  padding_left = 0,
  padding_right = 2,
})

notify_mail:subscribe({ "forced", "routine", "system_woke" }, function(env)
  sbar.exec("lsappinfo info -only StatusLabel \"Mail\" | grep -o '\"label\"=\"[0-9]*\"' | cut -d'\"' -f4",
    function(result)
      if tonumber(result) and tonumber(result) > 0 then
        notify_mail:set({ icon = { drawing = true } })
      else
        notify_mail:set({ icon = { drawing = false } })
      end
    end)
end)

notify_tg:subscribe({ "forced", "routine", "system_woke" }, function(env)
  sbar.exec("lsappinfo info -only StatusLabel \"Telegram\" | grep -o '\"label\"=\"[0-9]*\"' | cut -d'\"' -f4",
    function(result)
      if tonumber(result) and tonumber(result) > 0 then
        notify_tg:set({ icon = { drawing = true } })
      else
        notify_tg:set({ icon = { drawing = false } })
      end
    end)
end)
