local active = false

local on = function()
	active = true
end

local off = function()
	active = false
end

local toggle = function()
	active = not active
end

local is_active = function()
	return active
end

return {
	is_active = is_active,
	toggle = toggle,
	on = on,
	off = off,
}
