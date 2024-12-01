local colors = require("colors")
local icons = require("icons")
local settings = require("settings")
local app_icons = require("helpers.app_icons")

local spaces = {}
local function set_empty_icon_line(space)
  sbar.animate("tanh", 10, function()
    space:set({ label = { string = " —" } })
  end)
end

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


local function update_windows()
  sbar.exec("aerospace list-windows --format '%{workspace}:%{app-name}' --all", function(result, exit_code)
    if exit_code ~= 0 then
      print("Error executing aerospace command")
      return
    end

    local workspace_apps = {}
    for line in result:gmatch("[^\r\n]+") do
      local workspace, app = line:match("^(%d+):(.+)$")
      if workspace and app then
        workspace = tonumber(workspace)
        if not workspace_apps[workspace] then
          workspace_apps[workspace] = {}
        end
        workspace_apps[workspace][app] = true
      end
    end

    -- Set icon lines for all spaces in the spaces array
    for workspace, space in pairs(spaces) do
      local apps = workspace_apps[workspace]
      if apps then
        local icon_line = ""
        local app_count = 0
        for app, _ in pairs(apps) do
          local icon = app_icons[app] or app_icons["default"]
          if icon and icon ~= "" then
            icon_line = icon_line .. " " .. icon
            app_count = app_count + 1
          end
        end

        if app_count == 0 then
          set_empty_icon_line(space)
        else
          sbar.animate("tanh", 10, function()
            space:set({ label = { string = icon_line } })
          end)
        end
      else
        set_empty_icon_line(space)
      end
    end
  end)
end

-- Padding item required because of bracket
sbar.add("item", { width = 3 })

for i = 1, 9, 1 do
  local space = sbar.add("space", "space." .. i, {
    space = i,
    icon = {
      font = { family = settings.font.numbers },
      string = i,
      padding_left = 8,
      padding_right = 4,
      color = colors.grey,
      highlight_color = colors.accent,
    },
    label = {
      padding_right = 12,
      color = colors.grey,
      highlight_color = colors.white,
      font = "sketchybar-app-font:Regular:13.0",
      -- y_offset = -1,
    },
    padding_right = 1,
    padding_left = 1,
    background = {
      color = colors.bg2,
      border_width = 0,
      height = settings.bar.height - 4,
      border_color = colors.black,
    },
    popup = { background = { border_width = 5, border_color = colors.black } },
    apps = {}
  })

  spaces[i] = space

  -- Single item bracket for space items to achieve double border on highlight
  local space_bracket = sbar.add("bracket", { space.name }, {
    background = {
      color = colors.transparent,
      border_color = colors.bg2,
      height = settings.bar.height - 2,
      border_width = 2
    }
  })

  -- Padding space
  sbar.add("item", "space.padding." .. i, {
    script = "",
    width = settings.group_paddings,
  })

  local space_popup = sbar.add("item", {
    position = "popup." .. space.name,
    padding_left = 5,
    padding_right = 0,
    background = {
      drawing = true,
      image = {
        corner_radius = 9,
        scale = 0.2
      }
    }
  })

  -- space:subscribe("aerospace_focus_changed", function(env)
  --   -- print("window focus changed", space.name)
  --   update_windows()
  -- end)

  space:subscribe("space_change", function(env)
    local selected = env.SELECTED == "true"
    space:set({
      icon = { highlight = selected, },
      label = { highlight = selected },
      background = { border_color = selected and colors.black or colors.bg2 }
    })
    space_bracket:set({
      background = { border_color = selected and colors.accent or colors.bg2 }
    })
  end)

  space:subscribe("space_windows_change", function(env)
    local icon_line = ""
    local icon_line = ""
    local no_app = true
    for app, count in pairs(env.INFO.apps) do
      no_app = false
      local lookup = app_icons[app]
      local icon = ((lookup == nil) and app_icons["Default"] or lookup)
      icon_line = icon_line .. " " .. icon
    end
  
    if (no_app) then
      icon_line = " —"
    end
    sbar.animate("tanh", 10, function()
      spaces[env.INFO.space]:set({ label = icon_line })
    end)
  end)
  -- space:subscribe("space_windows_change", function(env)
  --   local icon_line = ""
  --   local no_app = true
  --   for app, count in pairs(env.INFO.apps) do
  --     no_app = false
  --     local lookup = app_icons[app]
  --     local icon = ((lookup == nil) and app_icons["Default"] or lookup)
  --     icon_line = icon_line .. icon
  --   end
  
  --   if (no_app) then
  --     icon_line = " —"
  --   end
  --   sbar.animate("tanh", 10, function()
  --     spaces[env.INFO.space]:set({ label = icon_line })
  --   end)
  -- end)

  -- space:subscribe("space_windows_change", function(env)
  --   local selected = env.INFO.space == space.name
  --   space:set({
  --     icon = { highlight = selected, },
  --     label = { highlight = selected },
  --     background = { border_color = selected and colors.black or colors.bg2 }
  --   })
  --   space_bracket:set({
  --     background = { border_color = selected and colors.accent or colors.bg2 }
  --   })
  --   update_windows()
  -- end)

  space:subscribe("mouse.clicked", function(env)
    sbar.exec("aerospace workspace " .. env.SID, function(result, exit_code)
    end)
  end)
end

local space_window_observer = sbar.add("item", {
  drawing = false,
  updates = true,
})

update_windows()
