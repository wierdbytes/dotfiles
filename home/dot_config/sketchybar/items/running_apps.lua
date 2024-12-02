local colors = require("colors")
local settings = require("settings")

local spaces = {}
local spaced_apps = {}

local active_app_prev = nil
local active_app_name = ""

local function dump(o)
  if type(o) == 'table' then
    local s = '{ '
    for k,v in pairs(o) do
      if type(k) ~= 'number' then k = '"'..k..'"' end
      s = s .. '['..k..'] = ' .. dump(v) .. ','
    end
    return s .. '} '
  else
    return tostring(o)
  end
end

local window_observer = sbar.add("item", "window_observer", {
  drawing = false,
  updates = true,
})

window_observer:subscribe("front_app_switched", function(env)
  if active_app_prev ~= nil and env.INFO ~= active_app_prev.name then
    sbar.animate("tanh", 5, function()
      active_app_prev:set({
        label = { width = 0 },
        icon = {background = {image = { scale = 0.5}}}} )
    end)
  end
  active_app_name = env.INFO
  for space, apps in pairs(spaced_apps) do
    for app, item in pairs(apps) do
      if app:gsub("space%.[0-9]+%.", "") == active_app_name then
        sbar.animate("tanh", 5, function()
          item:set({
            label = { width = "dynamic" },
            icon = {
              background = {
                image = {
                  scale = 0.8
                }
              }
            }
          })
        end)
        
        if active_app_prev ~= nil and active_app_prev ~= item then
          sbar.animate("tanh", 5, function()
            active_app_prev:set({
              label = { width = 0 },
              icon = {background = {image = { scale = 0.5}}}} )
          end)
        end
        active_app_prev = item
      end
    end
  end
end)

window_observer:subscribe("space_windows_change", function(env)
  local space = "space." .. env.INFO.space
  local old_apps = {}
  if spaced_apps[space] then
    for app, item in pairs(spaced_apps[space]) do
      old_apps[item.name] = item
    end
  end

  local app_names = {}
  for app_name, _ in pairs(env.INFO.apps) do
    table.insert(app_names, app_name)
  end
  table.sort(app_names)

  for _, app_name in ipairs(app_names) do
    local app_key = space .. "." .. app_name
    if old_apps[app_key] ~= nil then
      old_apps[app_key] = nil
    end
    if spaced_apps[space] == nil or spaced_apps[space][app_key] == nil then
      if spaced_apps[space] == nil then
        spaced_apps[space] = {}
      end
      local scale = 0.5
      local width = 0
      spaced_apps[space][app_key] = sbar.add("item", space .. "." .. app_name, {
        icon = {
          background = {
            drawing = true,
            image = {
              scale = scale,
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
          color = colors.white,
          width = width,
        },
        padding_right = 6,
        padding_left = 6,
        background = {
          color = colors.transparent,
          border_width = 0,
          height = settings.bar.height - 4,
          border_color = colors.red,
        },
      })
      spaced_apps[space][app_key]:set({
        icon = { background = { image = "app." .. app_name } },
        label = { string = app_name }
      })
      if active_app_name == app_name then
        sbar.animate("tanh", 5, function()
          spaced_apps[space][app_key]:set({
            label = { width = "dynamic" },
            icon = {
              background = {
                image = {
                  scale = 0.8
                }
              }
            }
          })
        end)
        active_app_prev = spaced_apps[space][app_key]
      end
    end
  end

  for app, item in pairs(old_apps) do
    sbar.exec("sketchybar --remove '" .. app .. "'", function(result, exit_code)
      spaced_apps[space][app] = nil
    end)
  end

end)
