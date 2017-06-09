/* enable CSS features that have JavaScript */
jQuery('html').removeClass('no-js');

/* determine if screen can handle touch events */
if ( ! (('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0))) {
	jQuery('html').addClass('no-touch');
}

/* simple way of determining if user is using a mouse */
var screenHasMouse = false;
function themeMouseMove() {
	screenHasMouse = true;
}
function themeTouchStart() {
	jQuery(window).off("mousemove");
	screenHasMouse = false;
	setTimeout(function() {
		jQuery(window).on("mousemove", themeMouseMove);
	}, 250);
}
if ( ! /(iPad|iPhone|iPod)/g.test(navigator.userAgent) ) {
	jQuery(window).on("touchstart", themeTouchStart).on("mousemove", themeMouseMove);
	if (window.navigator.msPointerEnabled) {
		document.addEventListener("MSPointerDown", themeTouchStart, false);
	}
}

jQuery(document).ready(function () { "use strict";

	/* handle both mouse hover and touch events for traditional menu + mobile hamburger */
	jQuery('#top .site-menu-toggle').on('click',function(e) {
		jQuery('#top').toggleClass('open-mobile-menu');
		e.preventDefault();
	});

	jQuery(document).on({
		mouseenter: function () {
			if (screenHasMouse) {
				jQuery(this).addClass("hover");
			}
		},
		mouseleave: function () {
			if (screenHasMouse) {
				jQuery(this).removeClass("hover");
			}
		}
	}, '#site-menu li:not(.menu-item-search)');

	if ( ! jQuery('html').hasClass('no-touch')) {
		jQuery('#site-menu li.menu-item-has-children > a').on('click', function (e) {
			if ( ! screenHasMouse && ! window.navigator.msPointerEnabled && ! jQuery('#top .site-menu-toggle').is(":visible") ) {
				var $parent = jQuery(this).parent();
				if ( ! $parent.parents('.hover').length) {
					jQuery('#site-menu li.menu-item-has-children').not($parent).removeClass('hover');
				}
				$parent.toggleClass("hover");
				e.preventDefault();
			}
		});

		/* toggle visibile dropdowns if touched outside the menu area */
		jQuery(document).on('click', function(e) {
			if (jQuery(e.target).parents('#site-menu').length > 0) {
				return;
			}
			jQuery('#site-menu li.menu-item-has-children, #site-menu li.menu-item-search').removeClass('hover');
		});
	}

	jQuery('#site-menu li.menu-item-search > a').on('click', function (e) {
		var $parent = jQuery(this).parent();
		if ( ! $parent.parents('.hover').length) {
			jQuery('#site-menu li.menu-item-has-children').not($parent).removeClass('hover');
		}
		$parent.toggleClass('hover');
		if ($parent.hasClass('hover')) {
			window.setTimeout(function() {
				jQuery('#site-menu .searchform input[type="search"]').focus();
			}, 150);
		}
		e.preventDefault();
	});

	jQuery('.tabs a').on('click', function (e) {
		var $parent = jQuery(this).parent();
		e.preventDefault();
		if ($parent.hasClass('active')) return;
		$parent.siblings('li').each(function() {
			jQuery(this).removeClass('active');
			jQuery(jQuery(this).find('a').attr('href')).hide();
		});
		$parent.addClass('active');
		var hash = $parent.find('a').attr('href');
		jQuery(hash).show();
	});

});

/* A fix for the iOS orientationchange zoom bug */
!function(a){function m(){d.setAttribute("content",g),h=!0}function n(){d.setAttribute("content",f),h=!1}function o(b){return a.orientation,90==Math.abs(a.orientation)?(h&&m(),void 0):(l=b.accelerationIncludingGravity,i=Math.abs(l.x),j=Math.abs(l.y),0==j||i/j>1.2?h&&n():h||m(),void 0)}var b=navigator.userAgent;if (/iPhone|iPad|iPod/.test(navigator.platform)&&/OS [1-5]_[0-9_]* like Mac OS X/i.test(b)&&b.indexOf("AppleWebKit")>-1&&-1==b.indexOf("CriOS")){var c=a.document;if (c.querySelector){var d=c.querySelector("meta[name=viewport]");if (d){var i,j,l,e=d&&d.getAttribute("content"),f=e+",maximum-scale=1",g=e+",maximum-scale=10",h=!0;a.addEventListener("orientationchange",m,!1),a.addEventListener("devicemotion",o,!1)}}}}(this);

/* Modernizr 2.8.3 (Custom Build) | MIT & BSD
 * Build: http://modernizr.com/download/#-csstransforms3d-csstransitions-cssclasses-teststyles-testprop-testallprops-prefixes-domprefixes
 */
;window.Modernizr=function(a,b,c){function z(a){j.cssText=a}function A(a,b){return z(m.join(a+";")+(b||""))}function B(a,b){return typeof a===b}function C(a,b){return!!~(""+a).indexOf(b)}function D(a,b){for(var d in a){var e=a[d];if(!C(e,"-")&&j[e]!==c)return b=="pfx"?e:!0}return!1}function E(a,b,d){for(var e in a){var f=b[a[e]];if(f!==c)return d===!1?a[e]:B(f,"function")?f.bind(d||b):f}return!1}function F(a,b,c){var d=a.charAt(0).toUpperCase()+a.slice(1),e=(a+" "+o.join(d+" ")+d).split(" ");return B(b,"string")||B(b,"undefined")?D(e,b):(e=(a+" "+p.join(d+" ")+d).split(" "),E(e,b,c))}var d="2.8.3",e={},f=!0,g=b.documentElement,h="modernizr",i=b.createElement(h),j=i.style,k,l={}.toString,m=" -webkit- -moz- -o- -ms- ".split(" "),n="Webkit Moz O ms",o=n.split(" "),p=n.toLowerCase().split(" "),q={},r={},s={},t=[],u=t.slice,v,w=function(a,c,d,e){var f,i,j,k,l=b.createElement("div"),m=b.body,n=m||b.createElement("body");if(parseInt(d,10))while(d--)j=b.createElement("div"),j.id=e?e[d]:h+(d+1),l.appendChild(j);return f=["&#173;",'<style id="s',h,'">',a,"</style>"].join(""),l.id=h,(m?l:n).innerHTML+=f,n.appendChild(l),m||(n.style.background="",n.style.overflow="hidden",k=g.style.overflow,g.style.overflow="hidden",g.appendChild(n)),i=c(l,a),m?l.parentNode.removeChild(l):(n.parentNode.removeChild(n),g.style.overflow=k),!!i},x={}.hasOwnProperty,y;!B(x,"undefined")&&!B(x.call,"undefined")?y=function(a,b){return x.call(a,b)}:y=function(a,b){return b in a&&B(a.constructor.prototype[b],"undefined")},Function.prototype.bind||(Function.prototype.bind=function(b){var c=this;if(typeof c!="function")throw new TypeError;var d=u.call(arguments,1),e=function(){if(this instanceof e){var a=function(){};a.prototype=c.prototype;var f=new a,g=c.apply(f,d.concat(u.call(arguments)));return Object(g)===g?g:f}return c.apply(b,d.concat(u.call(arguments)))};return e}),q.csstransforms3d=function(){var a=!!F("perspective");return a&&"webkitPerspective"in g.style&&w("@media (transform-3d),(-webkit-transform-3d){#modernizr{left:9px;position:absolute;height:3px;}}",function(b,c){a=b.offsetLeft===9&&b.offsetHeight===3}),a},q.csstransitions=function(){return F("transition")};for(var G in q)y(q,G)&&(v=G.toLowerCase(),e[v]=q[G](),t.push((e[v]?"":"no-")+v));return e.addTest=function(a,b){if(typeof a=="object")for(var d in a)y(a,d)&&e.addTest(d,a[d]);else{a=a.toLowerCase();if(e[a]!==c)return e;b=typeof b=="function"?b():b,typeof f!="undefined"&&f&&(g.className+=" "+(b?"":"no-")+a),e[a]=b}return e},z(""),i=k=null,e._version=d,e._prefixes=m,e._domPrefixes=p,e._cssomPrefixes=o,e.testProp=function(a){return D([a])},e.testAllProps=F,e.testStyles=w,g.className=g.className.replace(/(^|\s)no-js(\s|$)/,"$1$2")+(f?" js "+t.join(" "):""),e}(this,this.document);