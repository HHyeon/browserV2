<?php

function console_log($output, $with_script_tags = true) {
    $js_code = 'console.log(' . json_encode($output, JSON_HEX_TAG) . ');';
    if ($with_script_tags) {
        $js_code = '<script>' . $js_code . '</script>';
    }
    echo $js_code;
}

// $variable1 = 'ASDASDASD';
// console_log('php start !' . $variable1 . ' after variable');

$path = 'w4b';

$dirhandle=opendir($path);
$datalist = array();
$ret = false;

if($dirhandle)
{
	while(($entry=readdir($dirhandle)) !== FALSE)
	{
		// if($entry == "." || $entry == "..") continue;
		if(substr($entry, 0, 1) == ".") continue;
	
		// $timeddata = array();
		// $timeddata["t"] = date('Y-m-d H:i:s',filemtime($path.'/'.$entry));
		// $timeddata["d"] = $entry;
		// array_push($datalist, $timeddata);

		$posterpath = '';
		if(($hdir1 = opendir($path.'/'.$entry)))
		{
			while(($entry1=readdir($hdir1)) !== FALSE)
			{
				if(strpos($entry1, "jpg") > 0)
				{
					$posterpath = $entry1;
					break;
				} 
			}
			closedir($hdir1);
		}

		if($posterpath == '')
		{
			// console_log('no Poster At \''.$entry.'\'');
		}
		else
		{
			array_push($datalist, $path.'/'.$entry.'/'.$posterpath);
		}
		
		// console_log($entry);
	}
	closedir($dirhandle);
	
	// foreach($datalist as $item)
	// {
	// 	console_log($item);
	// }
	
	
	$ret = true;
}
else
{
	$ret = false;
	// console_log($path . 'dir open failed');
}

$result = array();
$result["data"] = $datalist;
$result["ret"] = $ret;
echo json_encode($result);

?>