local settings = require("settings")
local colors = require("colors")

local notified = true
local animated = false
local max_alpha = 0.8
local min_alpha = 0.0
local up_angle = 270
local down_angle = 90

local cur_alpha = max_alpha
local cur_angle = up_angle

local cal = sbar.add("item", "widgets.calendar", {
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
    padding_right = 0,
    width = 82,
    align = "left",
    font = {
      family = settings.font.numbers,
      size = settings.font_size_label,
    },
  },
  -- background = {
  --   drawing = true,
  --   color = colors.bar.bg,
  --   border_width = 0,
  --   height = settings.bar.height - 4,
  --   border_color = colors.transparent,
  --   padding_right = 20,
  --   shadow = {
  --     drawing = true,
  --     color = colors.transparent,
  --     angle = cur_angle,
  --     distance = 2,
  --   },
  -- },
  position = "right",
  update_freq = 1,
  padding_left = 0,
  padding_right = 4,
})

local animate_notify = function(col)
  if cur_alpha == max_alpha and cur_angle == down_angle then
    cur_angle = up_angle
  elseif cur_alpha == max_alpha and cur_angle == up_angle then
    cur_angle = down_angle
  end
  cal:set({
    background = {
      shadow = {
        angle = cur_angle,
      }
    }
  })
  sbar.animate("sin", 60, function()
    cal:set({
      background = {
        shadow = {
          color = colors.with_alpha(col, cur_alpha),
        }
      }
    })
  end)

  if cur_alpha ~= max_alpha then
    cur_alpha = max_alpha
  else
    cur_alpha = min_alpha
  end
end

local update_notify = function()
  local col = colors.transparent
  sbar.exec("lsappinfo info -only StatusLabel \"Mail\" | grep -o '\"label\"=\"[0-9]*\"' | cut -d'\"' -f4",
    function(res_mail)
      sbar.exec("lsappinfo info -only StatusLabel \"Telegram\" | grep -o '\"label\"=\"[0-9]*\"' | cut -d'\"' -f4",
        function(res_tg)
          if tonumber(res_mail) and tonumber(res_mail) > 0 and tonumber(res_tg) and tonumber(res_tg) > 0 then
            col = colors.red
          elseif tonumber(res_mail) and tonumber(res_mail) > 0 then
            col = colors.yellow
          elseif tonumber(res_tg) and tonumber(res_tg) > 0 then
            col = colors.accent
          else
            cal:set({ background = { shadow = { color = colors.transparent } } })
            return -- early return to save cpu cycles
          end
          if animated then
            animate_notify(col)
          else
            cal:set({ background = { shadow = { color = colors.with_alpha(col, max_alpha), angle = up_angle } } })
          end
        end)
    end)
end


cal:subscribe({ "forced", "routine", "system_woke" }, function(env)
  cal:set({ icon = os.date("[%d.%m]"), label = os.date("%H:%M:%S") })
  if notified then
    update_notify()
  end
end)

cal:subscribe("mouse.clicked", function(env)
  notified = not notified
end)
