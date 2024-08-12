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
  sbar.add("space", "space.padding." .. i, {
    space = i,
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

  space:subscribe("aerospace_focus_changed", function(env)
    -- print("window focus changed", space.name)
    update_windows()
  end)

  space:subscribe("aerospace_workspace_change", function(env)
    -- update_windows()
    -- print("workspace changed", env.FOCUSED_WORKSPACE)
    local selected = env.FOCUSED_WORKSPACE == space.name
    -- local color = selected and colors.accent or colors.bg2
    space:set({
      icon = { highlight = selected, },
      label = { highlight = selected },
      background = { border_color = selected and colors.black or colors.bg2 }
    })
    space_bracket:set({
      background = { border_color = selected and colors.accent or colors.bg2 }
    })
  end)

  space:subscribe("mouse.clicked", function(env)
    sbar.exec("aerospace workspace " .. env.SID, function(result, exit_code)
    end)
  end)

end

local space_window_observer = sbar.add("item", {
  drawing = false,
  updates = true,
})

local spaces_indicator = sbar.add("item", {
  padding_left = -3,
  padding_right = 0,
  icon = {
    padding_left = 8,
    padding_right = 9,
    color = colors.grey,
    string = icons.switch.on,
  },
  label = {
    width = 0,
    padding_left = 0,
    padding_right = 8,
    string = "Spaces",
    color = colors.bg1,
  },
  background = {
    color = colors.with_alpha(colors.grey, 0.0),
    border_color = colors.with_alpha(colors.bg1, 0.0),
  }
})

spaces_indicator:subscribe("swap_menus_and_spaces", function(env)
  local currently_on = spaces_indicator:query().icon.value == icons.switch.on
  spaces_indicator:set({
    icon = currently_on and icons.switch.off or icons.switch.on
  })
end)

spaces_indicator:subscribe("mouse.entered", function(env)
  sbar.animate("tanh", 30, function()
    spaces_indicator:set({
      background = {
        color = { alpha = 1.0 },
        border_color = { alpha = 1.0 },
      },
      icon = { color = colors.bg1 },
      label = { width = "dynamic" }
    })
  end)
end)

spaces_indicator:subscribe("mouse.exited", function(env)
  sbar.animate("tanh", 30, function()
    spaces_indicator:set({
      background = {
        color = { alpha = 0.0 },
        border_color = { alpha = 0.0 },
      },
      icon = { color = colors.grey },
      label = { width = 0, }
    })
  end)
end)

spaces_indicator:subscribe("mouse.clicked", function(env)
  sbar.trigger("swap_menus_and_spaces")
end)
