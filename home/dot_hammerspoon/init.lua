hs.ipc.cliInstall("/opt/homebrew")

-- stackline = require("stackline")
-- stackline:init()
-- stackline.config:toggle("appearance.showIcons")

-- Switch alacritty (from https://gist.github.com/truebit/31396bb2f48c75285d724c9e9e037bcd)
local spaces = require("hs.spaces") -- https://github.com/asmagill/hs._asm.spaces

local APP_NAME = "Ghostty"
-- local APP_NAME = 'Alacritty'
local BUNDLE_ID = "com.mitchellh.ghostty"
-- local BUNDLE_ID = 'org.alacritty'

FocusWatcher = hs.application.watcher.new(function(appName, eventType, appObject)
	if eventType == hs.application.watcher.deactivated and appName == APP_NAME then
		print("appName= " .. appName .. ", eventType= " .. eventType)
		appObject:hide()
	end
end)
--FocusWatcher:start()

hs.hotkey.bind({ "cmd", "alt", "ctrl", "shift" }, "T", function()
	function moveWindow(termemu, space, mainScreen)
		-- move to main space
		local win = nil
		while win == nil do
			win = termemu:mainWindow()
		end
		if win:isFullScreen() then
			hs.eventtap.keyStroke("cmd", "return", 0, termemu)
		end
		winFrame = win:frame()
		scrFrame = mainScreen:fullFrame()
		-- winFrame.w = scrFrame.w - 68
		-- winFrame.h = scrFrame.h - 120
		winFrame.h = 1320
		-- winFrame.y = scrFrame.y + 60
		winFrame.y = scrFrame.y + 24
		-- winFrame.x = scrFrame.x + 34
		winFrame.w = scrFrame.w
		-- winFrame.h = scrFrame.h
		-- winFrame.y = scrFrame.y
		winFrame.x = scrFrame.x
		win:setFrame(winFrame, 0)
		spaces.moveWindowToSpace(win, space)
		if win:isFullScreen() then
			hs.eventtap.keyStroke("cmd", "return", 0, termemu)
		end
		win:focus()
	end

	local terminal = hs.application.get(BUNDLE_ID)
	if terminal ~= nil and terminal:isFrontmost() then
		terminal:hide()
	else
		local space = spaces.activeSpaceOnScreen()
		local mainScreen = hs.screen.mainScreen()
		if terminal == nil and hs.application.launchOrFocusByBundleID(BUNDLE_ID) then
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
		if terminal ~= nil then
			moveWindow(terminal, space, mainScreen)
		end
	end
end)
