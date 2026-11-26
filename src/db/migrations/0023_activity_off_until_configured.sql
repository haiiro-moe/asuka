-- Activity capture is off until an admin has set the excluded channels and
-- turned it on (final review ruling): existing installs start off as well.
UPDATE `guild_config` SET `activity_enabled` = 0;
