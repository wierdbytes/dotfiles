hs.ipc.cliInstall("/opt/homebrew")

stackline = require "stackline"
stackline:init()
stackline.config:toggle('appearance.showIcons')

-- Switch alacritty (from https://gist.github.com/truebit/31396bb2f48c75285d724c9e9e037bcd)
local spaces = require("hs.spaces") -- https://github.com/asmagill/hs._asm.spaces

FocusWatcher = hs.application.watcher.new(function(appName, eventType, appObject)
  if eventType == hs.application.watcher.deactivated and appName == 'Alacritty' then
    print('appName= ' .. appName .. ', eventType= ' .. eventType)
    appObject:hide()
  end
end)
FocusWatcher:start()

hs.hotkey.bind({ "cmd", "alt", "ctrl", "shift" }, 'T', function()
  local BUNDLE_ID = 'org.alacritty' -- more accurate to avoid mismatching on browser titles
  function moveWindow(alacritty, space, mainScreen)
    -- move to main space
    local win = nil
    while win == nil do
      win = alacritty:mainWindow()
    end
    if win:isFullScreen() then
      hs.eventtap.keyStroke('cmd', 'return', 0, alacritty)
    end
    winFrame = win:frame()
    scrFrame = mainScreen:fullFrame()
    winFrame.w = scrFrame.w
    winFrame.y = scrFrame.y + 24
    winFrame.x = scrFrame.x
    win:setFrame(winFrame, 0)
    spaces.moveWindowToSpace(win, space)
    if win:isFullScreen() then
      hs.eventtap.keyStroke('cmd', 'return', 0, alacritty)
    end
    win:focus()
  end

  local alacritty = hs.application.get(BUNDLE_ID)
  if alacritty ~= nil and alacritty:isFrontmost() then
    alacritty:hide()
  else
    local space = spaces.activeSpaceOnScreen()
    local mainScreen = hs.screen.mainScreen()
    if alacritty == nil and hs.application.launchOrFocusByBundleID(BUNDLE_ID) then
      local appWatcher = nil
      appWatcher = hs.application.watcher.new(function(name, event, app)
        if event == hs.application.watcher.launched and app:bundleID() == BUNDLE_ID then
          app:hide()
          moveWindow(app, space, mainScreen)
          appWatcher:stop()
        end
      end)
      appWatcher:start()
    end
    if alacritty ~= nil then
      moveWindow(alacritty, space, mainScreen)
    end
  end
end)
