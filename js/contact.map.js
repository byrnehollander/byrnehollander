
jQuery(document).ready(function () { "use strict";

	var map_name = 'custom_gmap',
		loc = new google.maps.LatLng(40.795326, -73.960197), // set location
		stylers1 = [{
			"stylers": [
				{ "saturation": -100 },
				{ "invert_lightness": true },
				{ "lightness": -80 }
			]
		}],
		stylers2 = [{ 
			"stylers": [
				{ "saturation": -100 },
				{ "invert_lightness": true },
				{ "lightness": -30 }
			]
		}],
		mapOptions = {
			zoom: 15,
			center: loc,
			mapTypeId: map_name,
			disableDefaultUI: true,
			scrollwheel: false
		},
		map = new google.maps.Map(document.getElementById("gmap"), mapOptions),
		styledMapOptions = {
			map: map,
			name: map_name + "_map"
		},
		customMapType1 = new google.maps.StyledMapType(stylers1,styledMapOptions),
		customMapType2 = new google.maps.StyledMapType(stylers2,styledMapOptions);

	map.mapTypes.set(map_name, customMapType1);
	map.setMapTypeId(map_name);

	jQuery('#open-map').on('click', function(e) {
		e.preventDefault();
		jQuery(this).parents('.map-section').addClass('open');
		map.mapTypes.set(map_name, customMapType2);
	});

	jQuery('#close-map').on('click', function(e) {
		e.preventDefault();
		jQuery(this).parents('.map-section').removeClass('open');
		map.mapTypes.set(map_name, customMapType1);
	});

});